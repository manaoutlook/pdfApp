// ============================================================
// SmartPDF - Convert From PDF Handler
// Handles PDF → DOCX, XLSX, Images, TXT, CSV, HTML conversions
// Uses pdfjs-dist for text extraction + page rendering
// Uses docx, xlsx, mammoth libraries for output formats
// ============================================================

const { BrowserWindow, dialog } = require('electron');
const { openAndReadFile, saveBase64File } = require('../utils/file-dialogs');
const fs = require('fs');
const path = require('path');

// pdfjs-dist setup for Node.js (no canvas needed for text extraction)
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        HeadingLevel, AlignmentType, WidthType, BorderStyle,
        PageBreak, ShadingType } = require('docx');
const XLSX = require('xlsx');

function register(ipcMain) {
  // Open file dialog for a single PDF
  ipcMain.handle('convert:open-pdf', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return openAndReadFile(win, [{ name: 'PDF Files', extensions: ['pdf'] }], false);
  });

  // Choose output folder for batch saves (images, CSV per table)
  ipcMain.handle('convert:choose-folder', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = dialog.showOpenDialogSync(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose folder to save converted files',
    });
    if (!result || result.length === 0) return null;
    return result[0];
  });

  // Save a base64 file to disk
  ipcMain.handle('convert:save-file', async (event, { base64, fileName, outputDir }) => {
    try {
      const filePath = path.join(outputDir, fileName);
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(filePath, buffer);
      return true;
    } catch (err) {
      console.error('[convert] Failed to save file:', err);
      return false;
    }
  });

  // Save with a save dialog (returns filePath if saved, null if cancelled)
  ipcMain.handle('convert:save-dialog', async (event, { defaultName, filters }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = dialog.showSaveDialogSync(win, {
      defaultPath: defaultName,
      filters: filters,
    });
    return result || null;
  });

  // ============================================================
  // Core: Extract text with position info from all pages
  // ============================================================
  ipcMain.handle('convert:extract-text', async (event, { base64 }) => {
    try {
      const pdfBytes = Buffer.from(base64, 'base64');
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const totalPages = pdfDoc.numPages;
      const pagesData = [];

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1 });

        const items = textContent.items.map(item => ({
          text: item.str,
          x: Math.round(item.transform[4] * 100) / 100,
          y: Math.round((viewport.height - item.transform[5]) * 100) / 100,
          width: Math.round(item.width * 100) / 100,
          height: Math.round(item.height * 100) / 100,
          fontName: item.fontName || '',
          fontSize: Math.round(item.fontSize || 0),
        }));

        pagesData.push({
          pageNum: i,
          width: Math.round(viewport.width * 100) / 100,
          height: Math.round(viewport.height * 100) / 100,
          items: items,
          rawText: textContent.items.map(it => it.str).join(' '),
        });
      }

      return { success: true, data: { totalPages, pages: pagesData } };
    } catch (err) {
      console.error('[convert] extract-text error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → DOCX (with advanced table/formatting detection)
  // ============================================================
  ipcMain.handle('convert:to-docx', async (event, { base64, fileName }) => {
    try {
      const result = await extractAndConvertToDocx(base64);
      if (!result.success) return result;

      const docxBase64 = result.data.toString('base64');
      const defaultName = (fileName || 'output').replace(/\.pdf$/i, '') + '.docx';

      return { success: true, data: { base64: docxBase64, fileName: defaultName } };
    } catch (err) {
      console.error('[convert] to-docx error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → XLSX (extract tables)
  // ============================================================
  ipcMain.handle('convert:to-xlsx', async (event, { base64, fileName }) => {
    try {
      const result = await extractAndConvertToXlsx(base64);
      if (!result.success) return result;

      const xlsxBase64 = result.data.toString('base64');
      const defaultName = (fileName || 'output').replace(/\.pdf$/i, '') + '.xlsx';

      return { success: true, data: { base64: xlsxBase64, fileName: defaultName } };
    } catch (err) {
      console.error('[convert] to-xlsx error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → Images (PNG/JPEG per page)
  // ============================================================
  ipcMain.handle('convert:to-images', async (event, { base64, fileName, format, quality }) => {
    try {
      const pdfBytes = Buffer.from(base64, 'base64');
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      const totalPages = pdfDoc.numPages;
      const ext = format === 'jpeg' ? 'jpg' : 'png';
      const imageMime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const baseName = (fileName || 'output').replace(/\.pdf$/i, '');
      const images = [];

      // pdfjs-dist requires a canvas-like API for rendering. We use the 'canvas' package already installed.
      const { createCanvas } = require('canvas');

      for (let i = 1; i <= totalPages; i++) {
        const page = await pdfDoc.getPage(i);
        const scale = 2; // 2x for good quality
        const viewport = page.getViewport({ scale });

        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        let imageBuffer;
        if (format === 'jpeg') {
          imageBuffer = canvas.toBuffer('image/jpeg', { quality: quality || 85 });
        } else {
          imageBuffer = canvas.toBuffer('image/png');
        }

        const pageFileName = totalPages > 1
          ? `${baseName}_page${i}.${ext}`
          : `${baseName}.${ext}`;

        images.push({
          base64: imageBuffer.toString('base64'),
          fileName: pageFileName,
          pageNum: i,
        });
      }

      return { success: true, data: { images, totalPages } };
    } catch (err) {
      console.error('[convert] to-images error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → TXT
  // ============================================================
  ipcMain.handle('convert:to-txt', async (event, { base64, fileName }) => {
    try {
      const result = await extractTextFromPdf(base64);
      if (!result.success) return result;

      const txtContent = result.pages.map((p, i) => {
        const header = `--- Page ${i + 1} ---\n`;
        return header + p.rawText + '\n\n';
      }).join('');

      const txtBase64 = Buffer.from(txtContent, 'utf-8').toString('base64');
      const defaultName = (fileName || 'output').replace(/\.pdf$/i, '') + '.txt';

      return { success: true, data: { base64: txtBase64, fileName: defaultName } };
    } catch (err) {
      console.error('[convert] to-txt error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → CSV (extract tables)
  // ============================================================
  ipcMain.handle('convert:to-csv', async (event, { base64, fileName }) => {
    try {
      const result = await extractAndConvertToCsv(base64, fileName);
      if (!result.success) return result;

      return { success: true, data: result.data };
    } catch (err) {
      console.error('[convert] to-csv error:', err);
      return { success: false, error: err.message };
    }
  });

  // ============================================================
  // Convert: PDF → HTML
  // ============================================================
  ipcMain.handle('convert:to-html', async (event, { base64, fileName }) => {
    try {
      const result = await extractAndConvertToHtml(base64);
      if (!result.success) return result;

      const htmlBase64 = Buffer.from(result.data, 'utf-8').toString('base64');
      const defaultName = (fileName || 'output').replace(/\.pdf$/i, '') + '.html';

      return { success: true, data: { base64: htmlBase64, fileName: defaultName } };
    } catch (err) {
      console.error('[convert] to-html error:', err);
      return { success: false, error: err.message };
    }
  });
}

// ============================================================
// Core: Extract raw text from all pages
// ============================================================
async function extractTextFromPdf(base64) {
  try {
    const pdfBytes = Buffer.from(base64, 'base64');
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
    const totalPages = pdfDoc.numPages;
    const pages = [];

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map(it => it.str).join(' ');
      pages.push({ pageNum: i, rawText });
    }

    return { success: true, totalPages, pages };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
// Table Detection from PDF text items
// Detects tabular data by analyzing x-coordinate clustering
// ============================================================
function detectTables(textItems, pageWidth) {
  if (!textItems || textItems.length < 4) return null;

  // Group items by y-position (rows) — items within 8px vertically are same row
  const rowThreshold = 10;
  const rows = [];

  // Sort items by y, then x
  const sorted = [...textItems].sort((a, b) => a.y - b.y || a.x - b.x);

  let currentRow = { y: sorted[0].y, items: [sorted[0]] };
  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentRow.y) <= rowThreshold) {
      currentRow.items.push(item);
      currentRow.y = (currentRow.y * (currentRow.items.length - 1) + item.y) / currentRow.items.length;
    } else {
      rows.push(currentRow);
      currentRow = { y: item.y, items: [item] };
    }
  }
  rows.push(currentRow);

  // Only consider tables with 3+ rows and 2+ columns
  if (rows.length < 3) return null;

  // Detect column boundaries by clustering x-positions
  const xPositions = [];
  rows.forEach(row => {
    row.items.forEach(item => {
      if (item.text && item.text.trim()) {
        xPositions.push(item.x);
      }
    });
  });

  if (xPositions.length < 6) return null; // Too few data points

  // Sort unique x positions
  const uniqueXs = [...new Set(xPositions.map(x => Math.round(x / 5) * 5))].sort((a, b) => a - b);

  // Cluster nearby x positions into columns
  const colThreshold = 15;
  const columns = [];
  let currentCluster = [uniqueXs[0]];
  for (let i = 1; i < uniqueXs.length; i++) {
    if (uniqueXs[i] - uniqueXs[i - 1] <= colThreshold) {
      currentCluster.push(uniqueXs[i]);
    } else {
      columns.push(Math.round(currentCluster.reduce((s, v) => s + v, 0) / currentCluster.length));
      currentCluster = [uniqueXs[i]];
    }
  }
  columns.push(Math.round(currentCluster.reduce((s, v) => s + v, 0) / currentCluster.length));

  if (columns.length < 2) return null;

  // Build table data: assign each item to a column based on x position
  const table = {
    columns: columns.map((cx, i) => ({
      index: i,
      x: cx,
      header: '',
    })),
    rows: [],
  };

  rows.forEach(row => {
    const rowData = [];
    row.items.forEach(item => {
      if (!item.text || !item.text.trim()) return;
      // Find closest column
      let minDist = Infinity;
      let colIdx = 0;
      columns.forEach((cx, ci) => {
        const dist = Math.abs(item.x - cx);
        if (dist < minDist) {
          minDist = dist;
          colIdx = ci;
        }
      });
      rowData.push({ colIdx, text: item.text });
    });
    if (rowData.length >= 2) {
      const rowCells = table.columns.map(c => '');
      rowData.forEach(rd => {
        rowCells[rd.colIdx] = (rowCells[rd.colIdx] || '') + (rowCells[rd.colIdx] ? ' ' : '') + rd.text;
      });
      table.rows.push(rowCells);
    }
  });

  // Use first row as header if it looks like one
  if (table.rows.length >= 2) {
    const firstRow = table.rows[0];
    const isHeader = firstRow.every(cell => cell.length < 30);
    if (isHeader) {
      table.columns.forEach((col, i) => {
        col.header = firstRow[i] || '';
      });
      table.headerRow = table.rows.shift();
    }
  }

  return table.rows.length >= 2 ? table : null;
}

// ============================================================
// Detect headings based on font size
// ============================================================
function detectHeadingLevel(item, avgFontSize) {
  if (!item || !item.fontSize) return null;
  const ratio = item.fontSize / (avgFontSize || 11);
  if (ratio >= 1.8) return HeadingLevel.HEADING_1;
  if (ratio >= 1.4) return HeadingLevel.HEADING_2;
  if (ratio >= 1.2) return HeadingLevel.HEADING_3;
  return null;
}

// ============================================================
// PDF → DOCX conversion with advanced formatting
// ============================================================
async function extractAndConvertToDocx(base64) {
  const extractResult = await extractTextFromPdf(base64);
  if (!extractResult.success) return extractResult;

  // Re-extract with position info for advanced analysis
  const pdfBytes = Buffer.from(base64, 'base64');
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const totalPages = pdfDoc.numPages;

  const sections = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items = textContent.items.map(item => ({
      text: item.str,
      x: Math.round(item.transform[4] * 100) / 100,
      y: Math.round((viewport.height - item.transform[5]) * 100) / 100,
      width: Math.round(item.width * 100) / 100,
      fontSize: Math.round(item.fontSize * 10) / 10,
      fontName: item.fontName || '',
    }));

    // Calculate average font size for heading detection
    const fontSizes = items.filter(it => it.fontSize > 0).map(it => it.fontSize);
    const avgFontSize = fontSizes.length > 0
      ? fontSizes.reduce((s, v) => s + v, 0) / fontSizes.length
      : 11;

    // Detect tables
    const table = detectTables(items, viewport.width);

    if (table && table.rows.length >= 2) {
      // Create a DOCX table
      const docxTable = createDocxTable(table);
      sections.push(docxTable);
      sections.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
    } else {
      // Create paragraphs with heading detection
      const children = [];
      let currentParagraphTexts = [];

      // Group items by line (y-position)
      const lineThreshold = 5;
      const lines = [];
      const sortedItems = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

      let currentLine = { y: items.length > 0 ? sortedItems[0].y : 0, items: [] };
      for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        if (Math.abs(item.y - currentLine.y) <= lineThreshold) {
          currentLine.items.push(item);
          currentLine.y = (currentLine.y * (currentLine.items.length - 1) + item.y) / currentLine.items.length;
        } else {
          if (currentLine.items.length > 0) lines.push(currentLine);
          currentLine = { y: item.y, items: [item] };
        }
      }
      if (currentLine.items.length > 0) lines.push(currentLine);

      lines.forEach((line) => {
        const lineText = line.items.map(it => it.text).join(' ').trim();
        if (!lineText) {
          // Empty line = paragraph break
          if (currentParagraphTexts.length > 0) {
            children.push(createParagraph(currentParagraphTexts, avgFontSize));
            currentParagraphTexts = [];
          }
          return;
        }

        // Check if first item in line is a heading
        const firstItem = line.items[0];
        const headingLevel = detectHeadingLevel(firstItem, avgFontSize);

        if (headingLevel) {
          // Flush any pending paragraph
          if (currentParagraphTexts.length > 0) {
            children.push(createParagraph(currentParagraphTexts, avgFontSize));
            currentParagraphTexts = [];
          }
          children.push(new Paragraph({
            heading: headingLevel,
            spacing: { before: 240, after: 120 },
            children: [
              new TextRun({
                text: lineText,
                bold: true,
                size: firstItem.fontSize * 2 || 24,
              }),
            ],
          }));
        } else {
          currentParagraphTexts.push({
            text: lineText,
            isBold: line.items.length === 1 && line.items[0].text.trim().length > 0,
          });
        }
      });

      // Flush remaining paragraph
      if (currentParagraphTexts.length > 0) {
        children.push(createParagraph(currentParagraphTexts, avgFontSize));
      }

      if (children.length > 0) {
        sections.push(...children);
      }
    }

    // Page break between pages (except last)
    if (pageNum < totalPages) {
      sections.push(new Paragraph({
        children: [new PageBreak()],
      }));
    }
  }

  const doc = new Document({
    title: 'Converted from PDF',
    description: 'Generated by SmartPDF',
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch margins
        },
      },
      children: sections,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  return { success: true, data: buffer };
}

function createParagraph(textRuns, avgFontSize) {
  const children = textRuns.map(tr => {
    const isLarge = tr.text.length > 0;
    return new TextRun({
      text: tr.text,
      size: Math.round(avgFontSize * 2) || 22,
      bold: tr.isBold || false,
    });
  });
  return new Paragraph({
    spacing: { after: 120, line: 276 },
    children,
  });
}

function createDocxTable(tableData) {
  const rows = [];

  // Header row
  if (tableData.headerRow) {
    const headerCells = tableData.headerRow.map(cellText => {
      return new TableCell({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: cellText, bold: true, size: 20 })],
        })],
        shading: { type: ShadingType.SOLID, color: '#D9E2F3', fill: '#D9E2F3' },
      });
    });
    rows.push(new TableRow({ children: headerCells }));
  }

  // Data rows
  tableData.rows.forEach(rowData => {
    const cells = rowData.map(cellText => {
      return new TableCell({
        children: [new Paragraph({
          children: [new TextRun({ text: cellText, size: 20 })],
        })],
      });
    });
    rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

// ============================================================
// PDF → XLSX conversion
// ============================================================
async function extractAndConvertToXlsx(base64) {
  const pdfBytes = Buffer.from(base64, 'base64');
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const totalPages = pdfDoc.numPages;

  const workbook = XLSX.utils.book_new();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items = textContent.items.map(item => ({
      text: item.str,
      x: Math.round(item.transform[4] * 100) / 100,
      y: Math.round((viewport.height - item.transform[5]) * 100) / 100,
      width: Math.round(item.width * 100) / 100,
    }));

    // Try to detect tables first
    const table = detectTables(items, viewport.width);

    if (table && table.rows.length >= 2) {
      const sheetData = [];
      if (table.headerRow) {
        sheetData.push(table.headerRow);
      }
      table.rows.forEach(row => sheetData.push(row));
      const sheetName = `Page ${pageNum}`;
      const ws = XLSX.utils.aoa_to_sheet(sheetData);

      // Auto-fit column widths
      const colWidths = table.columns.map((col, i) => {
        const maxLen = sheetData.reduce((max, row) => {
          const cell = row[i] || '';
          return Math.max(max, String(cell).length);
        }, 10);
        return { wch: Math.min(maxLen + 2, 50) };
      });
      ws['!cols'] = colWidths;

      XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    } else if (items.length > 0) {
      // No table detected: put text in column A
      const lines = [];
      let currentLine = '';
      const sortedItems = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
      sortedItems.forEach(item => {
        if (item.text.trim()) {
          currentLine += (currentLine ? ' ' : '') + item.text.trim();
        }
      });
      if (currentLine) {
        lines.push([currentLine]);
      } else {
        // One row per text item
        sortedItems.forEach(item => {
          if (item.text.trim()) {
            lines.push([item.text.trim()]);
          }
        });
      }

      if (lines.length > 0) {
        const sheetName = `Page ${pageNum}`;
        const ws = XLSX.utils.aoa_to_sheet(lines);
        ws['!cols'] = [{ wch: 80 }];
        XLSX.utils.book_append_sheet(workbook, ws, sheetName);
      }
    }
  }

  // If no sheets were created, create a default one with raw text
  if (workbook.SheetNames.length === 0) {
    const txtResult = await extractTextFromPdf(base64);
    if (txtResult.success) {
      const data = txtResult.pages.map(p => [p.rawText]);
      const ws = XLSX.utils.aoa_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, ws, 'Content');
    }
  }

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  return { success: true, data: buffer };
}

// ============================================================
// PDF → CSV conversion
// ============================================================
async function extractAndConvertToCsv(base64, fileName) {
  const pdfBytes = Buffer.from(base64, 'base64');
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const totalPages = pdfDoc.numPages;

  const csvFiles = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items = textContent.items.map(item => ({
      text: item.str,
      x: Math.round(item.transform[4] * 100) / 100,
      y: Math.round((viewport.height - item.transform[5]) * 100) / 100,
    }));

    const table = detectTables(items, viewport.width);
    const baseName = (fileName || 'output').replace(/\.pdf$/i, '');

    if (table && table.rows.length >= 2) {
      const wsData = [];
      if (table.headerRow) wsData.push(table.headerRow);
      table.rows.forEach(row => wsData.push(row));

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      const csvFileName = totalPages > 1
        ? `${baseName}_page${pageNum}.csv`
        : `${baseName}.csv`;

      csvFiles.push({ fileName: csvFileName, data: csvContent });
    }
  }

  // If no tables detected, return raw text as single-column CSV
  if (csvFiles.length === 0) {
    const txtResult = await extractTextFromPdf(base64);
    if (txtResult.success) {
      const baseName = (fileName || 'output').replace(/\.pdf$/i, '');
      const lines = [];
      txtResult.pages.forEach((p, i) => {
        if (txtResult.pages.length > 1) lines.push([`Page ${i + 1}`]);
        lines.push([p.rawText]);
      });
      const ws = XLSX.utils.aoa_to_sheet(lines);
      const csvContent = XLSX.utils.sheet_to_csv(ws);
      csvFiles.push({ fileName: `${baseName}.csv`, data: csvContent });
    }
  }

  return { success: true, data: { files: csvFiles } };
}

// ============================================================
// PDF → HTML conversion
// ============================================================
async function extractAndConvertToHtml(base64) {
  const pdfBytes = Buffer.from(base64, 'base64');
  const pdfDoc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  const totalPages = pdfDoc.numPages;

  let htmlParts = [];
  htmlParts.push(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted from PDF</title>
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
    h1 { color: #1a73e8; border-bottom: 2px solid #1a73e8; padding-bottom: 8px; }
    h2 { color: #333; margin-top: 32px; }
    h3 { color: #555; margin-top: 24px; }
    p { margin: 12px 0; }
    .page-break { border-top: 2px dashed #ccc; margin: 40px 0; padding-top: 20px; color: #999; font-size: 12px; text-align: center; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; font-size: 14px; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <h1>📄 Document converted from PDF</h1>
  <p><em>Generated by SmartPDF &bull; ${totalPages} page${totalPages > 1 ? 's' : ''}</em></p>
`);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    const items = textContent.items.map(item => ({
      text: item.str,
      x: Math.round(item.transform[4] * 100) / 100,
      y: Math.round((viewport.height - item.transform[5]) * 100) / 100,
      fontSize: Math.round(item.fontSize * 10) / 10 || 11,
    }));

    if (totalPages > 1) {
      htmlParts.push(`  <div class="page-break">— Page ${pageNum} —</div>\n`);
    }

    // Detect tables
    const table = detectTables(items, viewport.width);

    if (table && table.rows.length >= 2) {
      htmlParts.push('  <table>\n');
      if (table.headerRow) {
        htmlParts.push('    <thead><tr>');
        table.headerRow.forEach(cell => {
          htmlParts.push(`<th>${escapeHtml(cell)}</th>`);
        });
        htmlParts.push('</tr></thead>\n');
      }
      htmlParts.push('    <tbody>\n');
      table.rows.forEach(row => {
        htmlParts.push('      <tr>');
        row.forEach(cell => {
          htmlParts.push(`<td>${escapeHtml(cell)}</td>`);
        });
        htmlParts.push('</tr>\n');
      });
      htmlParts.push('    </tbody>\n  </table>\n');
    } else {
      // Group by line
      let currentPara = '';
      sortedItems(items).forEach(item => {
        if (item.text.trim()) {
          currentPara += (currentPara ? ' ' : '') + escapeHtml(item.text.trim());
        } else if (currentPara) {
          htmlParts.push(`  <p>${currentPara}</p>\n`);
          currentPara = '';
        }
      });
      if (currentPara) {
        htmlParts.push(`  <p>${currentPara}</p>\n`);
      }
    }
  }

  htmlParts.push('</body>\n</html>');
  return { success: true, data: htmlParts.join('') };
}

function sortedItems(items) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

module.exports = { register };