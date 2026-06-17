const { dialog } = require('electron');
const fs = require('fs');

/**
 * Open a file dialog and read the selected file as base64
 * @param {BrowserWindow} window - The parent window
 * @param {object} filters - Dialog filters
 * @returns {object|null} { filePath, data (base64) }
 */
function openAndReadFile(window, filters) {
  const result = dialog.showOpenDialogSync(window, {
    filters,
    properties: ['openFile'],
  });
  if (!result || result.length === 0) return null;

  const filePath = result[0];
  const data = fs.readFileSync(filePath);
  return { filePath, data: data.toString('base64') };
}

/**
 * Save a base64-encoded file to disk
 * @param {BrowserWindow} window - The parent window
 * @param {object} filters - Dialog filters
 * @param {string} base64Data - The data to save
 * @returns {boolean} Success
 */
function saveBase64File(window, filters, base64Data) {
  const result = dialog.showSaveDialogSync(window, { filters });
  if (!result) return false;

  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFileSync(result, buffer);
  return true;
}

module.exports = { openAndReadFile, saveBase64File };