import os
import glob
import subprocess
import time
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance

DOWNLOADS_DIR = r"C:\Users\IT_COMMS\Downloads\md"
OUTPUT_DIR = r"C:\Users\IT_COMMS\Downloads\md\rendered_videos"
os.makedirs(OUTPUT_DIR, exist_ok=True)
SLIDES_DIR = os.path.join(OUTPUT_DIR, "slides_cache")
os.makedirs(SLIDES_DIR, exist_ok=True)

AUDIO_PATH = os.path.join(DOWNLOADS_DIR, "Happy Birthday_spotdown.org.mp3")

SLIDE_DURATION = 3.5  # seconds per slide
FADE_DURATION = 0.8   # seconds transition

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

def render_styled_slide(img_path, width, height, message, out_path):
    with Image.open(img_path) as orig:
        orig = orig.convert("RGB")
        orig_w, orig_h = orig.size

        canvas = Image.new("RGB", (width, height), (7, 26, 19))

        # 1. Background (blurred)
        bg_scale = max(width / orig_w, height / orig_h)
        bg_w, bg_h = int(orig_w * bg_scale), int(orig_h * bg_scale)
        bg = orig.resize((bg_w, bg_h), Image.Resampling.BILINEAR)
        bg_left = (bg_w - width) // 2
        bg_top = (bg_h - height) // 2
        bg = bg.crop((bg_left, bg_top, bg_left + width, bg_top + height))
        bg = bg.filter(ImageFilter.GaussianBlur(radius=20))
        bg = ImageEnhance.Brightness(bg).enhance(0.4)
        canvas.paste(bg, (0, 0))

        # 2. Foreground Image
        fg_scale = min((width * 0.86) / orig_w, (height * 0.74) / orig_h)
        fg_w, fg_h = int(orig_w * fg_scale), int(orig_h * fg_scale)
        fg = orig.resize((fg_w, fg_h), Image.Resampling.LANCZOS)
        
        fg_x = (width - fg_w) // 2
        fg_y = (height - fg_h) // 2 - 25

        # Border on photo
        draw_fg = ImageDraw.Draw(fg)
        draw_fg.rectangle([0, 0, fg_w - 1, fg_h - 1], outline=(212, 175, 55), width=3)
        canvas.paste(fg, (fg_x, fg_y))

        # 3. Framing & Corner Accents
        draw = ImageDraw.Draw(canvas)
        draw.rectangle([18, 18, width - 18, height - 18], outline=(30, 85, 65), width=1)
        border_col = (212, 175, 55)
        c_len = 28
        draw.line([(24, 24), (24 + c_len, 24)], fill=border_col, width=3)
        draw.line([(24, 24), (24, 24 + c_len)], fill=border_col, width=3)
        draw.line([(width - 24, 24), (width - 24 - c_len, 24)], fill=border_col, width=3)
        draw.line([(width - 24, 24), (width - 24, 24 + c_len)], fill=border_col, width=3)
        draw.line([(24, height - 24), (24 + c_len, height - 24)], fill=border_col, width=3)
        draw.line([(24, height - 24), (24, height - 24 - c_len)], fill=border_col, width=3)
        draw.line([(width - 24, height - 24), (width - 24 - c_len, height - 24)], fill=border_col, width=3)
        draw.line([(width - 24, height - 24), (width - 24, height - 24 - c_len)], fill=border_col, width=3)

        # Header Badge
        badge_font = get_font("cinzel.ttf", 20 if width > 1200 else 17)
        badge_text = "✨ ACOB EXECUTIVE BIRTHDAY TRIBUTE ✨"
        badge_bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
        badge_w = badge_bbox[2] - badge_bbox[0]
        draw.text(((width - badge_w) // 2, 32), badge_text, fill=(240, 215, 130), font=badge_font)

        # Message Banner at bottom
        top_line, mid_line, btm_line = message
        font_top = get_font("georgiab.ttf", 20 if width > 1200 else 16)
        font_mid = get_font("georgiab.ttf", 28 if width > 1200 else 24)
        font_btm = get_font("georgia.ttf", 18 if width > 1200 else 15)

        bar_h = 120 if width > 1200 else 105
        bar_y = height - bar_h - 32
        overlay = Image.new("RGBA", (width - 70, bar_h), (7, 26, 19, 215))
        canvas.paste(overlay, (35, bar_y), overlay)
        draw.rectangle([35, bar_y, width - 35, bar_y + bar_h], outline=(212, 175, 55), width=1)

        t_bbox = draw.textbbox((0, 0), top_line, font=font_top)
        draw.text(((width - (t_bbox[2] - t_bbox[0])) // 2, bar_y + 10), top_line, fill=(212, 175, 55), font=font_top)

        m_bbox = draw.textbbox((0, 0), mid_line, font=font_mid)
        draw.text(((width - (m_bbox[2] - m_bbox[0])) // 2, bar_y + 38), mid_line, fill=(255, 255, 255), font=font_mid)

        b_bbox = draw.textbbox((0, 0), btm_line, font=font_btm)
        draw.text(((width - (b_bbox[2] - b_bbox[0])) // 2, bar_y + 78), btm_line, fill=(180, 215, 200), font=font_btm)

        canvas.save(out_path, quality=95)

def build_fast_video(orientation="landscape"):
    t0 = time.time()
    width, height = (1920, 1080) if orientation == "landscape" else (1080, 1920)
    output_filename = f"MD_Birthday_Tribute_{'16x9_Landscape' if orientation == 'landscape' else '9x16_Portrait'}.mp4"
    output_path = os.path.join(OUTPUT_DIR, output_filename)

    imgs = sorted(glob.glob(os.path.join(DOWNLOADS_DIR, "*.jpg")) + glob.glob(os.path.join(DOWNLOADS_DIR, "*.png")))
    n_slides = len(imgs)
    print(f"Generating {n_slides} high-resolution styled slides ({orientation})...")

    slide_paths = []
    for i, img_p in enumerate(imgs):
        msg = MESSAGES[i % len(MESSAGES)]
        slide_out = os.path.join(SLIDES_DIR, f"{orientation}_slide_{i:02d}.jpg")
        render_styled_slide(img_p, width, height, msg, slide_out)
        slide_paths.append(slide_out)

    print("Building FFmpeg crossfade stream...")
    # Build filter_complex with xfade
    # Each slide plays for SLIDE_DURATION
    # offset for slide i is i * (SLIDE_DURATION - FADE_DURATION)
    inputs = []
    for p in slide_paths:
        inputs.extend(["-loop", "1", "-t", str(SLIDE_DURATION), "-i", p])

    filter_parts = []
    prev_node = "[0:v]"
    current_offset = SLIDE_DURATION - FADE_DURATION

    for i in range(1, n_slides):
        next_node = f"[v{i}]"
        filter_parts.append(
            f"{prev_node}[{i}:v]xfade=transition=fade:duration={FADE_DURATION}:offset={current_offset:.2f}{next_node}"
        )
        prev_node = next_node
        current_offset += (SLIDE_DURATION - FADE_DURATION)

    total_video_dur = current_offset + FADE_DURATION
    filter_complex = ";".join(filter_parts)

    audio_idx = n_slides
    cmd = [
        "ffmpeg", "-y",
        *inputs,
        "-i", AUDIO_PATH,
        "-filter_complex", f"{filter_complex};[{audio_idx}:a]afade=t=in:st=0:d=1.5,afade=t=out:st={total_video_dur - 2.5}:d=2.5[a]",
        "-map", prev_node,
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "256k",
        "-t", str(total_video_dur),
        output_path
    ]

    print(f"Rendering {output_filename} with FFmpeg...")
    subprocess.run(cmd, check=True)
    print(f"Finished {output_filename} in {time.time() - t0:.1f}s!")
    return output_path

if __name__ == "__main__":
    out1 = build_fast_video("landscape")
    out2 = build_fast_video("portrait")
    print(f"\nALL VIDEOS COMPLETED IN {OUTPUT_DIR}")
