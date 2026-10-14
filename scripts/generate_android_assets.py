import os
from PIL import Image, ImageDraw

def generate_assets():
    source_path = r"C:\Users\DELL 3310\.gemini\antigravity-ide\brain\d1640715-3713-4457-8091-8a670ff8c047\homel_pro_branding_1791979675498.jpg"
    res_dir = r"android\app\src\main\res"
    bg_color = (14, 18, 21) # #0E1215

    im_source = Image.open(source_path).convert("RGBA")

    # 1. Extract the Mark (H symbol)
    # Bounding box of H: X [331, 692], Y [262, 595] -> center (511, 428)
    # Let's crop a tight bounding box around H
    h_crop = im_source.crop((325, 255, 698, 602))
    
    # Create transparent version of H
    w_h, h_h = h_crop.size
    h_rgba = h_crop.copy()
    pixels = h_rgba.load()
    for y in range(h_h):
        for x in range(w_h):
            r, g, b, a = pixels[x, y]
            diff = max(abs(r - bg_color[0]), abs(g - bg_color[1]), abs(b - bg_color[2]))
            if diff < 15:
                pixels[x, y] = (0, 0, 0, 0)
            elif diff < 35:
                alpha = int((diff - 15) / 20.0 * 255)
                pixels[x, y] = (r, g, b, alpha)

    # 2. Extract the Full Lockup (H mark + HOMEL text) for Splash
    # Bounding box: X [216, 807], Y [262, 762]
    lockup_crop = im_source.crop((210, 250, 815, 770))

    # Density specifications for mipmaps
    mipmap_specs = {
        "mipmap-mdpi": {"launcher": 48, "foreground": 108},
        "mipmap-hdpi": {"launcher": 72, "foreground": 162},
        "mipmap-xhdpi": {"launcher": 96, "foreground": 216},
        "mipmap-xxhdpi": {"launcher": 144, "foreground": 324},
        "mipmap-xxxhdpi": {"launcher": 192, "foreground": 432},
    }

    print("Generating Mipmap Icons...")
    for folder, spec in mipmap_specs.items():
        folder_path = os.path.join(res_dir, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # A. Adaptive Foreground (transparent, centered in safe 66% zone)
        fg_size = spec["foreground"]
        fg_im = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        target_h_size = int(fg_size * 0.58)
        ratio = target_h_size / max(h_rgba.size)
        scaled_w = int(h_rgba.width * ratio)
        scaled_h = int(h_rgba.height * ratio)
        scaled_h_mark = h_rgba.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        offset_x = (fg_size - scaled_w) // 2
        offset_y = (fg_size - scaled_h) // 2
        fg_im.paste(scaled_h_mark, (offset_x, offset_y), scaled_h_mark)
        fg_im.save(os.path.join(folder_path, "ic_launcher_foreground.png"), "PNG")

        # B. Standard Legacy Launcher (Square with dark bg + H mark)
        l_size = spec["launcher"]
        legacy_im = Image.new("RGBA", (l_size, l_size), (*bg_color, 255))
        target_legacy_size = int(l_size * 0.72)
        ratio = target_legacy_size / max(h_rgba.size)
        scaled_w = int(h_rgba.width * ratio)
        scaled_h = int(h_rgba.height * ratio)
        scaled_h_mark = h_rgba.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        offset_x = (l_size - scaled_w) // 2
        offset_y = (l_size - scaled_h) // 2
        legacy_im.paste(scaled_h_mark, (offset_x, offset_y), scaled_h_mark)
        legacy_im.save(os.path.join(folder_path, "ic_launcher.png"), "PNG")

        # C. Round Launcher (Circle mask with dark bg + H mark)
        round_im = Image.new("RGBA", (l_size, l_size), (0, 0, 0, 0))
        mask = Image.new("L", (l_size, l_size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, l_size - 1, l_size - 1), fill=255)
        round_im.paste(legacy_im, (0, 0), mask)
        round_im.save(os.path.join(folder_path, "ic_launcher_round.png"), "PNG")

    print("Generating Splash Screens...")
    splash_specs = {
        "drawable-port-xxxhdpi": (1280, 1920),
        "drawable-port-xxhdpi": (960, 1600),
        "drawable-port-xhdpi": (720, 1280),
        "drawable-port-hdpi": (480, 800),
        "drawable-port-mdpi": (320, 480),
        "drawable-land-xxxhdpi": (1920, 1280),
        "drawable-land-xxhdpi": (1600, 960),
        "drawable-land-xhdpi": (1280, 720),
        "drawable-land-hdpi": (800, 480),
        "drawable-land-mdpi": (480, 320),
        "drawable": (480, 320),
    }

    for folder, (sw, sh) in splash_specs.items():
        folder_path = os.path.join(res_dir, folder)
        os.makedirs(folder_path, exist_ok=True)
        splash_im = Image.new("RGBA", (sw, sh), (*bg_color, 255))
        
        # In portrait: lockup width ~50% of screen width
        # In landscape: lockup height ~45% of screen height
        if sh > sw: # portrait
            target_w = int(sw * 0.55)
            scale = target_w / lockup_crop.width
        else: # landscape
            target_h = int(sh * 0.45)
            scale = target_h / lockup_crop.height
            
        scaled_w = int(lockup_crop.width * scale)
        scaled_h = int(lockup_crop.height * scale)
        scaled_lockup = lockup_crop.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)
        
        ox = (sw - scaled_w) // 2
        oy = (sh - scaled_h) // 2
        splash_im.paste(scaled_lockup, (ox, oy))
        splash_im.save(os.path.join(folder_path, "splash.png"), "PNG")

    # Also save web assets
    os.makedirs(r"src\assets", exist_ok=True)
    h_rgba.save(r"src\assets\homel_icon.png", "PNG")
    lockup_crop.save(r"src\assets\homel_logo.png", "PNG")
    print("All assets successfully created!")

if __name__ == "__main__":
    generate_assets()
