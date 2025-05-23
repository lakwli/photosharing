import fs from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import process from "process";
import { FILE_STORAGE_CONFIG } from "../config.js";

const { TEMP_PHOTOS_DIR } = FILE_STORAGE_CONFIG;

// Ensure upload directory exists
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Ensures that specified directories exist, creating them if necessary
 * @param {string[]} directories - Array of directory paths to ensure exist
 * @param {Object} options - Options for directory creation
 * @param {boolean} options.silent - Whether to suppress console output (default: false)
 * @param {boolean} options.recursive - Whether to create parent directories (default: true)
 * @returns {Object} - Statistics about the operation (created, existing, failed)
 */
export function ensureDirectoriesExist(directories = [], options = {}) {
  const { silent = false, recursive = true } = options;
  const stats = { created: 0, existing: 0, failed: 0 };

  if (!silent) console.log("Ensuring required directories exist...");

  // Create each directory if it doesn't exist
  for (const dir of directories) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive });
        stats.created++;
        if (!silent) console.log(`Created directory: ${dir}`);
      } else {
        stats.existing++;
        if (!silent) console.log(`Directory already exists: ${dir}`);
      }
    } catch (error) {
      stats.failed++;
      if (!silent) console.error(`Failed to create directory: ${dir}`, error);
    }
  }

  if (!silent) console.log("Directory check completed.");
  return stats;
}

// Get upload directory path
function getUploadDir(userId, memoryId) {
  // Use temp_photos directory for uploads as they start as temporary files
  const baseUploadDir = process.env.UPLOAD_DIR || TEMP_PHOTOS_DIR;
  const userDir = path.join(baseUploadDir, `user_${userId}`);
  const memoryDir = path.join(userDir, `memory_${memoryId}`);

  return ensureDir(memoryDir);
}

// Generate unique filename
function generateUniqueFilename(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  return `${uuidv4()}${ext}`;
}

// Process image (create optimized and thumbnail versions)
async function processImage(options = {}) {
  const {
    inputPath: originalPath,
    targetDir,
    baseName,
    width = 2000,
    height = 2000,
    quality = 85,
  } = options;

  console.log("[processImage] Received parameters:", {
    originalPath,
    targetDir,
    baseName,
    width,
    height,
    quality,
  });

  if (!targetDir || !baseName) {
    console.error("[processImage] Error: targetDir and baseName are required.");
    throw new Error("targetDir and baseName are required for processImage");
  }

  ensureDir(targetDir);

  const optimizedFileName = `${baseName}.webp`;
  const optimizedPath = path.join(targetDir, optimizedFileName);
  console.log(`[processImage] Optimized path will be: ${optimizedPath}`);

  try {
    console.log(
      `[processImage] Attempting to get metadata for: ${originalPath}`
    );
    let fileMetadata;
    try {
      fileMetadata = await sharp(originalPath).metadata();
      console.log(
        "[processImage] Successfully retrieved metadata:",
        fileMetadata
      );
    } catch (metadataError) {
      console.error(
        `[processImage] Error retrieving metadata for ${originalPath}:`,
        metadataError
      );
      throw metadataError; // Re-throw to be caught by the outer try-catch
    }

    console.log(
      `[processImage] Attempting to resize and convert to WebP: ${originalPath}`
    );
    await sharp(originalPath)
      .resize(width, height, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality })
      .toFile(optimizedPath);
    console.log(
      `[processImage] Successfully processed and saved to: ${optimizedPath}`
    );

    if (fs.existsSync(originalPath)) {
      console.log(
        `[processImage] Deleting original temporary file: ${originalPath}`
      );
      fs.unlinkSync(originalPath);
    }

    const newFileSize = (await fs.promises.stat(optimizedPath)).size;
    console.log(`[processImage] New file size: ${newFileSize} bytes`);

    return {
      processedPath: optimizedPath,
      metadata: {
        width: fileMetadata.width, // Use metadata from the successful call
        height: fileMetadata.height,
        format: "webp",
        originalFormat: fileMetadata.format,
        size: newFileSize,
      },
    };
  } catch (error) {
    console.error(
      `[processImage] Error during image processing for ${originalPath}:`,
      error
    );
    if (fs.existsSync(optimizedPath)) {
      console.log(
        `[processImage] Cleaning up partially created file: ${optimizedPath}`
      );
      fs.unlinkSync(optimizedPath);
    }
    throw error;
  }
}

// Renamed from cleanupOnError and modified to handle single or multiple files
async function deleteFiles(files) {
  if (!Array.isArray(files)) files = [files];

  for (const file of files) {
    if (file && typeof file === "string") {
      // Ensure it's a string path
      try {
        if (fs.existsSync(file)) {
          // Check if file exists before attempting to delete
          await fs.promises.unlink(file);
        }
      } catch (err) {
        console.error(`Error deleting file ${file}:`, err.message);
      }
    }
  }
}

// New function to delete a single file
async function deleteFile(filePath) {
  if (filePath && typeof filePath === "string") {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true; // Indicate success
      } else {
        return false; // Indicate file not found
      }
    } catch (err) {
      console.error(`Error deleting file ${filePath}:`, err.message);
      throw err; // Re-throw for the caller to handle
    }
  }
  return false; // Indicate invalid path or no action taken
}

// New function to delete a file and its parent directory if empty
async function deleteFileAndEmptyParent(filePath) {
  if (filePath && typeof filePath === "string") {
    try {
      if (fs.existsSync(filePath)) {
        try {
          await fs.promises.unlink(filePath); // Delete the file
          console.log(
            `[deleteFileAndEmptyParent] File deleted successfully: ${filePath}`
          );
        } catch (fileError) {
          console.error(
            `[deleteFileAndEmptyParent] Failed to delete file: ${filePath}`,
            fileError
          );
          throw fileError;
        }
        const parentDir = path.dirname(filePath);
        console.log(
          `[deleteFileAndEmptyParent] Checking parent directory: ${parentDir}`
        );
        let remainingFiles;
        try {
          remainingFiles = await fs.promises.readdir(parentDir);
          console.log(
            `[deleteFileAndEmptyParent] Directory contents before deletion: ${remainingFiles}`
          );
        } catch (readError) {
          console.error(
            `[deleteFileAndEmptyParent] Failed to read directory contents: ${parentDir}`,
            readError
          );
          throw readError;
        }
        console.log(
          `[deleteFileAndEmptyParent] Remaining files in directory: ${remainingFiles}`
        );
        if (remainingFiles.length === 0) {
          try {
            await fs.promises.rmdir(parentDir); // Remove the directory if empty
            console.log(
              `[deleteFileAndEmptyParent] Folder deleted successfully: ${parentDir}`
            );
          } catch (folderError) {
            console.error(
              `[deleteFileAndEmptyParent] Failed to delete folder: ${parentDir}`,
              folderError
            );
            throw folderError;
          }
          console.log(
            `[deleteFileAndEmptyParent] Removed empty directory: ${parentDir}`
          );
        }
      }
    } catch (err) {
      console.error(
        `Error deleting file or directory ${filePath}:`,
        err.message
      );
      throw err; // Re-throw for the caller to handle
    }
  }
}

export {
  ensureDir,
  getUploadDir,
  generateUniqueFilename,
  processImage,
  deleteFiles, // Export renamed function
  deleteFile, // Export new function
  deleteFileAndEmptyParent, // Export new utility
};
