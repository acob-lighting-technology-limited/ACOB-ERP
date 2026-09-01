import os
import glob
import subprocess
import shutil
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

DOWNLOADS_DIR = r"C:\Users\IT_COMMS\Downloads\md"
OUTPUT_DIR = r"C:\Users\IT_COMMS\Downloads\md\rendered_videos"
os.makedirs(OUTPUT_DIR, exist_ok=True)
TEMP_DIR = os.path.join(OUTPUT_DIR, "temp_frames")
os.makedirs(TEMP_DIR, exist_ok=True)

LOGO_PATH = r"c:\Users\IT_COMMS\GitHubProjects\ACOB-Signature-Creator\public\images\signature\acob-10th-anniversary.png"
AUDIO_PATH = os.path.join(DOWNLOADS_DIR, "Happy Birthday_spotdown.org.mp3")

FPS = 30
SLIDE_DURATION_SEC = 3.6  # Duration per image
TRANSITION_FRAMES = 18    # Crossfade frames (~0.6s)

MESSAGES = [
    ("HAPPY BIRTHDAY", "MR. ALEXANDER C. OBIECHINA", "Managing Director & CEO"),
    ("CELEBRATING A VISIONARY LEADER", "Guiding ACOB with Excellence & Passion", "Executive Management"),
    ("DECADE OF IMPACT", "Pioneering Sustainable Energy Solutions", "10 Years of Leadership"),
    ("INSPIRING GROWTH", "Empowering Teams & Building the Future", "ACOB Lighting Technology Ltd"),
    ("TRANSFORMATIVE LEADERSHIP", "A Man of Vision, Character & Integrity", "Executive Tribute"),
    ("DRIVING INNOVATION", "Lighting Communities Across the Nation", "Powering Progress"),
    ("WITH WARMEST WISHES", "From Management & the Entire ACOB Family", "Happy Birthday Sir! 🎂🥂"),
]

def get_font(font_name, size):
    font_paths = [
        os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", font_name),
        os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "georgia.ttf"),
        os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "arial.ttf"),
    ]
    for p in font_paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def process_slide(image_path, width, height, progress, message=None, is_intro=False, is_outro=False):
    # progress is 0.0 to 1.0 during this slide
    with Image.open(image_path) as orig:
        orig = orig.convert("RGB")
        orig_w, orig_h = orig.size

        # Create base canvas
        canvas = Image.new("RGB", (width, height), (7, 26, 19))
        
        # Blurred background for artistic cinematic framing
        bg_scale = max(width / orig_w, height / orig_h) * 1.15
        bg_new_w, bg_new_h = int(orig_w * bg_scale), int(orig_h * bg_scale)
        bg = orig.resize((bg_new_w, bg_new_h), Image.Resampling.LANCZOS)
        
        # Center crop bg
        bg_left = (bg_new_w - width) // 2
        bg_top = (bg_new_h - height) // 2
        bg = bg.crop((bg_left, bg_top, bg_left + width, bg_top + height))
        bg = bg.filter(ImageFilter.GaussianBlur(radius=25))
        enhancer = ImageEnhance.Brightness(bg)
        bg = enhancer.enhance(0.4)
        canvas.paste(bg, (0, 0))

        # Ken Burns zoom effect for main foreground image
        zoom = 1.0 + (progress * 0.08) # Zoom in 8%
        
        # Fit foreground image inside canvas with margin
        fg_scale_fit = min((width * 0.88) / orig_w, (height * 0.78) / orig_h)
        fg_scaled_w = int(orig_w * fg_scale_fit * zoom)
        fg_scaled_h = int(orig_h * fg_scale_fit * zoom)
        
        fg = orig.resize((fg_scaled_w, fg_scaled_h), Image.Resampling.LANCZOS)
        
        # Slight pan
        pan_offset_x = int((progress - 0.5) * 20)
        pan_offset_y = int((progress - 0.5) * 15)
        
        fg_x = (width - fg_scaled_w) // 2 + pan_offset_x
        fg_y = (height - fg_scaled_h) // 2 - 20 + pan_offset_y

        # Drop shadow / border
        shadow = Image.new("RGBA", (fg_scaled_w + 20, fg_scaled_h + 20), (0, 0, 0, 160))
        shadow = shadow.filter(ImageFilter.GaussianBlur(10))
        canvas.paste(shadow, (fg_x - 10, fg_y - 10), shadow)

        # White/Gold border on image
        draw_border = ImageDraw.Draw(fg)
        draw_border.rectangle([0, 0, fg_scaled_w - 1, fg_scaled_h - 1], outline=(212, 175, 55), width=3)
        canvas.paste(fg, (fg_x, fg_y))

        draw = ImageDraw.Draw(canvas)

        # Subtle gold decorative corner border lines on the full canvas
        border_col = (212, 175, 55)
        draw.rectangle([20, 20, width - 20, height - 20], outline=(30, 80, 60), width=1)
        
        # Corner brackets
        c_len = 30
        draw.line([(25, 25), (25 + c_len, 25)], fill=border_col, width=3)
        draw.line([(25, 25), (25, 25 + c_len)], fill=border_col, width=3)
        draw.line([(width - 25, 25), (width - 25 - c_len, 25)], fill=border_col, width=3)
        draw.line([(width - 25, 25), (width - 25, 25 + c_len)], fill=border_col, width=3)
        draw.line([(25, height - 25), (25 + c_len, height - 25)], fill=border_col, width=3)
        draw.line([(25, height - 25), (25, height - 25 - c_len)], fill=border_col, width=3)
        draw.line([(width - 25, height - 25), (width - 25 - c_len, height - 25)], fill=border_col, width=3)
        draw.line([(width - 25, height - 25), (width - 25, height - 25 - c_len)], fill=border_col, width=3)

        # Header Badge
        badge_font = get_font("cinzel.ttf", 20 if width > 1200 else 18)
        badge_text = "✨ ACOB EXECUTIVE BIRTHDAY TRIBUTE ✨"
        badge_bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
        badge_w = badge_bbox[2] - badge_bbox[0]
        draw.text(((width - badge_w) // 2, 35), badge_text, fill=(240, 215, 130), font=badge_font)

        # Message Banner at bottom
        if message:
            top_line, mid_line, btm_line = message
            font_top = get_font("georgiab.ttf", 22 if width > 1200 else 18)
            font_mid = get_font("georgiab.ttf", 32 if width > 1200 else 26)
            font_btm = get_font("georgia.ttf", 20 if width > 1200 else 16)

            # Translucent text bar
            bar_h = 130 if width > 1200 else 115
            bar_y = height - bar_h - 35
            overlay = Image.new("RGBA", (width - 80, bar_h), (7, 26, 19, 210))
            canvas.paste(overlay, (40, bar_y), overlay)

            # Border on message box
            draw.rectangle([40, bar_y, width - 40, bar_y + bar_h], outline=(212, 175, 55), width=1)

            # Draw text
            t_bbox = draw.textbbox((0, 0), top_line, font=font_top)
            draw.text(((width - (t_bbox[2] - t_bbox[0])) // 2, bar_y + 12), top_line, fill=(212, 175, 55), font=font_top)

            m_bbox = draw.textbbox((0, 0), mid_line, font=font_mid)
            draw.text(((width - (m_bbox[2] - m_bbox[0])) // 2, bar_y + 44), mid_line, fill=(255, 255, 255), font=font_mid)

            b_bbox = draw.textbbox((0, 0), btm_line, font=font_btm)
            draw.text(((width - (b_bbox[2] - b_bbox[0])) // 2, bar_y + 88), btm_line, fill=(180, 215, 200), font=font_btm)

        return canvas

def render_video(orientation="landscape"):
    width, height = (1920, 1080) if orientation == "landscape" else (1080, 1920)
    output_filename = f"MD_Birthday_Tribute_{'16x9_Landscape' if orientation == 'landscape' else '9x16_Portrait'}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_filename)
    
    # Clean temp frames
    for f in glob.glob(os.path.join(TEMP_DIR, "*.*")):
        os.remove(f)

    # Gather images
    all_imgs = sorted(glob.glob(os.path.join(DOWNLOADS_DIR, "*.jpg")) + glob.glob(os.path.join(DOWNLOADS_DIR, "*.png")))
    if not all_imgs:
        print("No images found in folder!")
        return

    print(f"\n==========================================")
    print(f"Rendering {orientation.upper()} Video ({width}x{height}) with {len(all_imgs)} photos...")
    print(f"==========================================")

    frames_per_slide = int(FPS * SLIDE_DURATION_SEC)
    total_slides = len(all_imgs)
    frame_counter = 0

    prev_slide_last_frame = None

    for slide_idx, img_path in enumerate(all_imgs):
        # Pick message
        msg_idx = slide_idx % len(MESSAGES)
        msg = MESSAGES[msg_idx]

        print(f"Rendering Slide {slide_idx + 1}/{total_slides}: {os.path.basename(img_path)}...")

        slide_frames = []
        for f in range(frames_per_slide):
            progress = f / float(frames_per_slide)
            frame_img = process_slide(img_path, width, height, progress, message=msg)
            slide_frames.append(frame_img)

        # Write frames with cross-dissolve transition from previous slide
        for f_idx, current_frame in enumerate(slide_frames):
            if prev_slide_last_frame is not None and f_idx < TRANSITION_FRAMES:
                # Alpha blend
                alpha = f_idx / float(TRANSITION_FRAMES)
                blended = Image.blend(prev_slide_last_frame, current_frame, alpha)
                frame_save_path = os.path.join(TEMP_DIR, f"frame_{frame_counter:06d}.jpg")
                blended.save(frame_save_path, quality=92)
            else:
                frame_save_path = os.path.join(TEMP_DIR, f"frame_{frame_counter:06d}.jpg")
                current_frame.save(frame_save_path, quality=92)
            
            frame_counter += 1

        prev_slide_last_frame = slide_frames[-1]

    total_duration_sec = frame_counter / float(FPS)
    print(f"Generated {frame_counter} frames ({total_duration_sec:.1f} seconds).")

    # Encode with FFmpeg
    print("Encoding video with FFmpeg & merging audio track...")
    cmd = [
        "ffmpeg", "-y",
        "-framerate", str(FPS),
        "-i", os.path.join(TEMP_DIR, "frame_%06d.jpg"),
        "-i", AUDIO_PATH,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-t", str(total_duration_sec),
        "-filter_complex", f"[1:a]afade=t=in:st=0:d=1.5,afade=t=out:st={total_duration_sec - 2.5}:d=2.5[a]",
        "-map", "0:v:0",
        "-map", "[a]",
        output_path
    ]

    subprocess.run(cmd, check=True)
    print(f"✅ Successfully exported video: {output_path}")
    return output_path

if __name__ == "__main__":
    # Render Landscape (16:9)
    out_landscape = render_video("landscape")
    # Render Portrait (9:16) for WhatsApp/Reels/Phone
    out_portrait = render_video("portrait")
    print("\n🎉 ALL VIDEOS PROCESSED & READY IN DOWNLOADS/MD/RENDERED_VIDEOS 🎉")
