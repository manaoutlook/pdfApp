// ============================================================
// SmartPDF - Convert To PDF Handler
// Handles DOCX, XLSX, Images, TXT, HTML, CSV → PDF conversions
// Uses pdf-lib for PDF creation, mammoth for DOCX, xlsx for XLSX
// ============================================================

const { BrowserWindow, dialog } = require('electron');
const { openAndReadFile } = require('../utils/file-dialogs');
const fs = require('fs');
const path = require('path');

// pdfjs-dist for text extraction (used for DOCX text fallback)
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { PDFDocument, rgb, StandardFonts, PageSizes } = require('pdf-lib');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

function register(ipcMain) {
  // Open file dialog for supported input formats
  ipcMain.handle('convert-to:open-file', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [
      { name: 'Supported Formats', extensions: ['docx', 'xlsx', 'xls', 'png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff', 'tif', 'txt', 'html', 'htm', 'csv'] },
      { name: 'Word Documents', extensions: ['docx'] },
      { name: 'Excel Workbooks', extensions: ['xlsx', 'xls'] },
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff', 'tif'] },
      { name: 'Text Files', extensions: ['txt'] },
      { name: 'HTML Files', extensions: ['html', 'htm'] },
      { name: 'CSV Files', extensions: ['csv'] },
    ], false);
  });

  // Open file dialog for MULTIPLE images (batch to single PDF)
  ipcMain.handle('convert-to:open-images', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tiff', 'tif'] },
    ], true);
  });

  // Save PDF with save dialog
  ipcMain.handle('convert-to:save-pdf', async (event, { base64, defaultName }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = dialog.showSaveDialogSync(win, {
      defaultPath: defaultName,
      filters: [{ name: 'PDF File', extensions: ['pdf'] }],
    });
    if (!result) return null;

    try {
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(result, buffer);
      return result;
    } catch (err) {
      console.error('[convert-to] Failed to save PDF:', err);
      return null;
    }
  });

  // ============================================================
  // Detect file type from extension
  // ============================================================
  ipcMain.handle('convert-to:detect-type', async (event, { filePath }) => {
    const ext = path.extname(filePath).toLowerCase();
    let type = 'unknown';
    if (['.docx'].includes(ext)) type = 'docx';
    else if (['.xlsx', '.xls'].includes(ext)) type = 'xlsx';
    else if (['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.tiff', '.tif'].includes(ext)) type = 'image';
    else if (['.txt'].includes(ext)) type = 'txt';
    else if (['.html', '.htm'].includes(ext)) type = 'html';
    else if (['.csv'].includes(ext)) type = 'csv';
    return { type, ext };
  });

  // ============================================================
  // Convert: Image(s) → PDF
  // ============================================================
  ipcMain.handle('convert-to:from-image', async (event, { base64Array, fileNames, pageSize, orientation, margin }) => {
    try {
      const pdfDoc = await PDFDocument.create();
      const { createCanvas, loadImage } = require('canvas');

      for (let i = 0; i < base64Array.length; i++) {
        const imgBuffer = Buffer.from(base64Array[i], 'base64');
        const ext = path.extname(fileNames[i]).toLowerCase();

        let image;
        if (ext === '.png') {
          image = await pdfDoc.embedPng(imgBuffer);
        } else if (['.jpg', '.jpeg'].includes(ext)) {
          image = await pdfDoc.embedJpg(imgBuffer);
        } else {
          // BMP, GIF, TIFF — convert via canvas to PNG buffer
          const img = await loadImage(imgBuffer);
          const canvas = createCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          const pngBuffer = canvas.toBuffer('image/png');
          image = await pdfDoc.embedPng(pngBuffer);
        }

        const size = getPageSize(pageSize || 'A4', orientation || 'portrait');
        const m = margin || 40;
        const page = pdfDoc.addPage(size);

        // Calculate scale to fit within margins
        const maxW = size[0] - m * 2;
        const maxH = size[1] - m * 2;
        const scale = Math.min(maxW / image.width, maxH / image.height);
        const scaledW = image.width * scale;
        const scaledH = image.height * scale;
        const x = (size[0] - scaledW) / 2;
        const y = (size[1] - scaledH) / 2;

        page.drawImage(image, { x, y, width: scaledW, height: scaledH });
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const defaultName = base64Array.length === 1
        ? fileNames[0].replace(/\.[^.]+$/, '') + '.pdf'
        : 'images_combined.pdf';

      return { success: true, data: { base64: Buffer.from(pdfBytes).toString('base64'), fileName: defaultName } };
    } catch (err) {
      console.error('[convert-to] from-image error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: TXT → PDF
  // ============================================================
  ipcMain.handle('convert-to:from-txt', async (event, { base64, fileName, pageSize, orientation, margin }) => {
    try {
      const textContent = Buffer.from(base64, 'base64').toString('utf-8');
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Courier);

      const size = getPageSize(pageSize || 'A4', orientation || 'portrait');
      const m = margin || 40;
      const fontSize = 11;
      const lineHeight = fontSize * 1.4;
      const maxW = size[0] - m * 2;
      const maxH = size[1] - m * 2;
      const charsPerLine = Math.floor(maxW / (fontSize * 0.6));
      const linesPerPage = Math.floor(maxH / lineHeight);

      const lines = wrapText(textContent, charsPerLine);
      let lineIdx = 0;

      while (lineIdx < lines.length) {
        const page = pdfDoc.addPage(size);
        let y = size[1] - m - fontSize;

        for (let i = 0; i < linesPerPage && lineIdx < lines.length; i++) {
          page.drawText(lines[lineIdx], {
            x: m,
            y: y,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
          y -= lineHeight;
          lineIdx++;
        }
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const defaultName = (fileName || 'output').replace(/\.[^.]+$/, '') + '.pdf';

      return { success: true, data: { base64: Buffer.from(pdfBytes).toString('base64'), fileName: defaultName } };
    } catch (err) {
      console.error('[convert-to] from-txt error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: DOCX → PDF
  // ============================================================
  ipcMain.handle('convert-to:from-docx', async (event, { base64, fileName, pageSize, orientation, margin }) => {
    try {
      const docxBuffer = Buffer.from(base64, 'base64');

      // Use mammoth to convert DOCX to HTML
      const result = await mammoth.convertToHtml({ buffer: docxBuffer });
      const htmlContent = result.value;

      // Extract text content from HTML (strip tags)
      const textContent = htmlContent.replace(/<[^>]+>/g, ' ')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/&#[0-9]+;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Also detect headings from HTML
      const headings = [];
      const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
      let match;
      while ((match = headingRegex.exec(htmlContent)) !== null) {
        headings.push({
          level: parseInt(match[1]),
          text: match[2].replace(/<[^>]+>/g, '').trim(),
          index: match.index,
        });
      }

      // Render to PDF
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const size = getPageSize(pageSize || 'A4', orientation || 'portrait');
      const m = margin || 40;
      const fontSize = 11;
      const headingSizes = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 };
      const lineHeight = fontSize * 1.4;
      const maxW = size[0] - m * 2;
      const maxH = size[1] - m * 2;
      const charsPerLine = Math.floor(maxW / (fontSize * 0.5));

      // Split into paragraphs
      const paragraphs = textContent.split(/\n{2,}/).filter(p => p.trim());

      let page = pdfDoc.addPage(size);
      let y = size[1] - m - fontSize;
      let pageNum = 1;

      function addPageBreak() {
        page = pdfDoc.addPage(size);
        y = size[1] - m - fontSize;
        pageNum++;
      }

      for (let p = 0; p < paragraphs.length; p++) {
        const para = paragraphs[p].trim();
        if (!para) continue;

        // Check if this paragraph matches a heading
        const headingMatch = headings.find(h => para.startsWith(h.text) || h.text.startsWith(para.substring(0, 40)));
        const isHeading = headingMatch !== undefined;
        const headingLevel = isHeading ? headingMatch.level : 0;
        const hSize = isHeading ? (headingSizes[headingLevel] || 16) : fontSize;
        const hLineH = hSize * 1.3;
        const currentFont = isHeading ? boldFont : font;

        // Check if heading needs a new page
        if (y - hLineH < m) {
          addPageBreak();
        }

        if (isHeading) {
          // Draw heading with spacing
          y -= 12; // extra space before heading
          if (y - hLineH < m) addPageBreak();

          const lines = wrapText(para, Math.floor(maxW / (hSize * 0.55)));
          for (let l = 0; l < lines.length; l++) {
            if (y - hLineH < m) addPageBreak();
            page.drawText(lines[l], {
              x: m,
              y: y,
              size: hSize,
              font: currentFont,
              color: rgb(0.1, 0.1, 0.1),
            });
            y -= hLineH;
          }
          y -= 8; // extra space after heading
        } else {
          // Draw paragraph
          const lines = wrapText(para, charsPerLine);
          for (let l = 0; l < lines.length; l++) {
            if (y - lineHeight < m) addPageBreak();
            page.drawText(lines[l], {
              x: m,
              y: y,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
            });
            y -= lineHeight;
          }
          y -= lineHeight * 0.5; // paragraph spacing
        }
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const defaultName = (fileName || 'output').replace(/\.[^.]+$/, '') + '.pdf';

      return { success: true, data: { base64: Buffer.from(pdfBytes).toString('base64'), fileName: defaultName } };
    } catch (err) {
      console.error('[convert-to] from-docx error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: XLSX/CSV → PDF
  // ============================================================
  ipcMain.handle('convert-to:from-xlsx', async (event, { base64, fileName, pageSize, orientation, margin }) => {
    try {
      const workbook = XLSX.read(Buffer.from(base64, 'base64'), { type: 'buffer' });
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const size = getPageSize(pageSize || 'A4', orientation || 'portrait');
      const m = margin || 40;
      const fontSize = 9;
      const headerSize = 10;
      const rowHeight = fontSize * 1.8;
      const headerRowH = headerSize * 2;
      const maxW = size[0] - m * 2;
      const tableStartY = size[1] - m - headerRowH - 20;

      let page = pdfDoc.addPage(size);
      let currentY = tableStartY;
      let sheetIdx = 0;

      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (!data || data.length === 0) return;

        // Sheet title
        if (currentY - rowHeight < m) {
          page = pdfDoc.addPage(size);
          currentY = tableStartY;
        }

        page.drawText(`Sheet: ${sheetName}`, {
          x: m,
          y: currentY + headerRowH,
          size: 12,
          font: boldFont,
          color: rgb(0.1, 0.1, 0.6),
        });
        currentY -= headerRowH + 10;

        // Calculate column widths
        const colCount = Math.max(...data.map(row => row.length || 0));
        const colWidth = Math.min(maxW / colCount, 120);
        const totalW = colWidth * colCount;
        const startX = m + (maxW - totalW) / 2;

        // Draw header row
        const headerRow = data[0] || [];
        if (currentY - headerRowH < m) {
          page = pdfDoc.addPage(size);
          currentY = tableStartY;
        }

        // Header background
        page.drawRectangle({
          x: startX,
          y: currentY - headerRowH + rowHeight * 0.3,
          width: totalW,
          height: headerRowH,
          color: rgb(0.85, 0.9, 0.95),
        });

        for (let c = 0; c < colCount; c++) {
          const cellText = String(headerRow[c] || '');
          page.drawText(cellText.substring(0, Math.floor(colWidth / 5)), {
            x: startX + c * colWidth + 3,
            y: currentY - 2,
            size: headerSize,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
        }
        currentY -= headerRowH + 4;

        // Draw data rows
        for (let r = 1; r < data.length; r++) {
          const row = data[r] || [];

          if (currentY - rowHeight < m) {
            page = pdfDoc.addPage(size);
            currentY = tableStartY;
          }

          // Alternating row background
          if (r % 2 === 0) {
            page.drawRectangle({
              x: startX,
              y: currentY - rowHeight + rowHeight * 0.3,
              width: totalW,
              height: rowHeight,
              color: rgb(0.97, 0.97, 0.97),
            });
          }

          for (let c = 0; c < colCount; c++) {
            const cellText = String(row[c] || '');
            page.drawText(cellText.substring(0, Math.floor(colWidth / 5)), {
              x: startX + c * colWidth + 3,
              y: currentY - 3,
              size: fontSize,
              font: font,
              color: rgb(0, 0, 0),
            });
          }
          currentY -= rowHeight;
        }

        currentY -= 24; // spacing between sheets
        sheetIdx++;
      });

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const defaultName = (fileName || 'output').replace(/\.[^.]+$/, '') + '.pdf';

      return { success: true, data: { base64: Buffer.from(pdfBytes).toString('base64'), fileName: defaultName } };
    } catch (err) {
      console.error('[convert-to] from-xlsx error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: HTML → PDF
  // ============================================================
  ipcMain.handle('convert-to:from-html', async (event, { base64, fileName, pageSize, orientation, margin }) => {
    try {
      const htmlContent = Buffer.from(base64, 'base64').toString('utf-8');

      // Strip HTML tags for text extraction
      const textContent = htmlContent.replace(/<[^>]+>/g, ' ')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/\s+/g, ' ')
        .trim();

      // Extract headings
      const headings = [];
      const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
      let match;
      while ((match = headingRegex.exec(htmlContent)) !== null) {
        headings.push({
          level: parseInt(match[1]),
          text: match[2].replace(/<[^>]+>/g, '').trim(),
        });
      }

      // Render to PDF (same approach as DOCX)
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

      const size = getPageSize(pageSize || 'A4', orientation || 'portrait');
      const m = margin || 40;
      const fontSize = 11;
      const headingSizes = { 1: 24, 2: 20, 3: 16, 4: 14, 5: 12, 6: 11 };
      const lineHeight = fontSize * 1.4;
      const maxW = size[0] - m * 2;
      const charsPerLine = Math.floor(maxW / (fontSize * 0.5));

      const paragraphs = textContent.split(/\n{2,}/).filter(p => p.trim());

      let page = pdfDoc.addPage(size);
      let y = size[1] - m - fontSize;

      function addPageBreak() {
        page = pdfDoc.addPage(size);
        y = size[1] - m - fontSize;
      }

      for (let p = 0; p < paragraphs.length; p++) {
        const para = paragraphs[p].trim();
        if (!para) continue;

        const headingMatch = headings.find(h => para.startsWith(h.text) || h.text.startsWith(para.substring(0, 40)));
        const isHeading = headingMatch !== undefined;
        const headingLevel = isHeading ? headingMatch.level : 0;
        const hSize = isHeading ? (headingSizes[headingLevel] || 16) : fontSize;
        const hLineH = hSize * 1.3;
        const currentFont = isHeading ? boldFont : font;

        if (isHeading) {
          y -= 12;
          if (y - hLineH < m) addPageBreak();

          const lines = wrapText(para, Math.floor(maxW / (hSize * 0.55)));
          for (let l = 0; l < lines.length; l++) {
            if (y - hLineH < m) addPageBreak();
            page.drawText(lines[l], {
              x: m, y: y, size: hSize, font: currentFont, color: rgb(0.1, 0.1, 0.1),
            });
            y -= hLineH;
          }
          y -= 8;
        } else {
          const lines = wrapText(para, charsPerLine);
          for (let l = 0; l < lines.length; l++) {
            if (y - lineHeight < m) addPageBreak();
            page.drawText(lines[l], {
              x: m, y: y, size: fontSize, font: font, color: rgb(0, 0, 0),
            });
            y -= lineHeight;
          }
          y -= lineHeight * 0.5;
        }
      }

      const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
      const defaultName = (fileName || 'output').replace(/\.[^.]+$/, '') + '.pdf';

      return { success: true, data: { base64: Buffer.from(pdfBytes).toString('base64'), fileName: defaultName } };
    } catch (err) {
      console.error('[convert-to] from-html error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ============================================================
// Helper: Get page size array from name + orientation
// ============================================================
function getPageSize(pageSize, orientation) {
  let size;
  switch (pageSize.toUpperCase()) {
    case 'A3': size = PageSizes.A3; break;
    case 'A5': size = PageSizes.A5; break;
    case 'LETTER': size = PageSizes.Letter; break;
    case 'LEGAL': size = PageSizes.Legal; break;
    case 'TABLOID': size = PageSizes.Tabloid; break;
    default: size = PageSizes.A4; break;
  }

  if (orientation === 'landscape') {
    return [size[1], size[0]]; // Swap width/height
  }
  return size;
}

// ============================================================
// Helper: Wrap text to fit within line width
// ============================================================
function wrapText(text, charsPerLine) {
  if (charsPerLine <= 0) return [text];
  const lines = [];
  const words = text.split(/(\s+)/);
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Handle newlines in the text
    if (word === '\n' || word === '\r\n') {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = '';
      continue;
    }

    if ((currentLine + word).length > charsPerLine) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += word;
    }
  }

  if (currentLine.trim()) lines.push(currentLine.trim());
  if (lines.length === 0 && text.trim()) lines.push(text.trim());

  return lines;
}

module.exports = { register };