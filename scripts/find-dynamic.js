const fs = require("fs")
const path = require("path")

function findDynamicFolders(dir) {
  try {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const fullPath = path.join(dir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        if (file.startsWith("[") && file.endsWith("]")) {
          console.log(fullPath)
        }
        findDynamicFolders(fullPath)
      }
    }
  } catch (e) {
    // Ignore permission or file not found errors for external folders
  }
}

findDynamicFolders("app")
