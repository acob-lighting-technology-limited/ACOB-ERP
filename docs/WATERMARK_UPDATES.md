# Watermark System Updates

## Summary of Changes

### 1. ✅ Custom File Naming for Batch Export
**Feature:** Users can now specify a custom name for exported images.

**How it works:**
- When exporting multiple images, an input field appears: "Custom File Name (Optional)"
- Enter a base name (e.g., "Home")
- Exported files will be named: `Home_1.jpg`, `Home_2.jpg`, `Home_3.jpg`, etc.
- If left empty, defaults to: `watermarked_1.jpg`, `watermarked_2.jpg`, etc.

**File naming convention:**
- Uses underscores for sequential numbering: `Name_1`, `Name_2`, `Name_10`
- Special characters are automatically sanitized (replaced with underscores)
- ZIP file is named with the custom name: `Home.zip`

**Example:**
- Input: "Living Room"
- Output files: `Living_Room_1.jpg`, `Living_Room_2.jpg`, `Living_Room_3.jpg`
- ZIP file: `Living_Room.zip`

---

### 2. ✅ Website Optimized as Default Preset
**Change:** The watermark tool now defaults to "Website Optimized" preset instead of "Custom"

**Default settings when you open the tool:**
- Position: Center Down 20%
- Opacity: 30%
- Size: 18%

**Why this change:**
- Most users will use the watermark for website images
- Provides optimal protection without manual configuration
- Professional settings out of the box

---

### 3. ✅ Website Optimized Preset Updated to 20% Offset
**Change:** Updated from 25% to 20% center-down offset

**Updated Website Optimized preset:**
- Position: **Center Down 20%** (was 25%)
- Opacity: **30%** (unchanged)
- Size: **18%** (unchanged)

**Why 20% offset:**
- More balanced positioning
- Still below center for subtle placement
- Easier to see on various image compositions
- Industry standard positioning

---

## Technical Implementation

### Files Modified:

1. **`components/watermark-studio.tsx`**
   - Added `customFileName` state variable
   - Added Input component import
   - Added custom file name input field (shows only when multiple images are uploaded)
   - Updated batch processing logic to use custom names with sequential numbering
   - Changed default preset from "custom" to "website-optimized"
   - Updated default config to match Website Optimized preset
   - Updated Website Optimized preset to use `center-down-20` position
   - Updated ZIP file naming to use custom name

2. **Position remains supported:**
   - All existing positions still work: center-down-10, center-down-20, center-down-25
   - Website Optimized now uses center-down-20 by default

---

## How to Use

### Basic Usage (Single Image):
1. Open `/watermark`
2. Upload an image
3. The tool starts with "Website Optimized" preset (center-down-20, 30% opacity, 18% size)
4. Click "Apply Watermark"
5. Download the result

### Batch Usage with Custom Names:
1. Open `/watermark`
2. Upload multiple images (e.g., 10 photos)
3. Enter a custom name in the "Custom File Name" field (e.g., "Home")
4. Preview shows: "Files will be named: Home_1, Home_2, etc."
5. Click "Apply to All X Images"
6. Download the ZIP file named `Home.zip`
7. Extract to get: `Home_1.jpg`, `Home_2.jpg`, ..., `Home_10.jpg`

---

## Available Presets

All presets remain available for selection:

| Preset | Position | Size | Opacity | Use Case |
|--------|----------|------|---------|----------|
| **Website Optimized** ⭐ | Center Down 20% | 18% | 30% | Default - Perfect for website images |
| Custom | Middle Right | 25% | 44% | Manual configuration |
| Subtle Corner | Bottom Right | 15% | 30% | Social media |
| Prominent Center | Center | 30% | 50% | Maximum protection |

---

## Benefits

✅ **Faster workflow** - Website Optimized preset is ready immediately  
✅ **Better organization** - Custom naming makes file management easier  
✅ **Professional output** - Consistent, numbered file names  
✅ **Flexible** - Can still use any preset or manual settings  
✅ **User-friendly** - Live preview of file naming convention  

---

## Notes

- Custom file names are sanitized automatically (special characters → underscores)
- Numbering starts at 1 (not 0)
- File extensions are preserved based on output format
- ZIP file uses the same custom name as the files inside
