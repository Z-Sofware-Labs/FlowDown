import os
import struct
import io
import shutil
from PIL import Image

def build_icns(img, out_path):
    defs = [
        ("icp4", 16),
        ("icp5", 32),
        ("ic11", 32),
        ("icp6", 64),
        ("ic12", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic13", 256),
    ]
    chunks = []
    total_len = 8
    for ostype, size in defs:
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format="PNG")
        png_bytes = buf.getvalue()
        chunk_len = 8 + len(png_bytes)
        total_len += chunk_len
        header = struct.pack(">4sI", ostype.encode("ascii"), chunk_len)
        chunks.append(header + png_bytes)
    
    file_header = struct.pack(">4sI", b"icns", total_len)
    with open(out_path, "wb") as f:
        f.write(file_header + b"".join(chunks))
    print(f"Generated ICNS: {out_path} ({total_len} bytes)")

def build_ico(img, out_path):
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(out_path, format="ICO", sizes=sizes)
    print(f"Generated ICO: {out_path}")

def generate_pngs(img, base_name, out_dir, sizes):
    for s in sizes:
        if "hicolor" in out_dir:
            target_dir = os.path.join(out_dir, f"{s}x{s}", "mimetypes")
        else:
            target_dir = os.path.join(out_dir, "mimetypes", str(s))
        os.makedirs(target_dir, exist_ok=True)
        target_path = os.path.join(target_dir, f"{base_name}.png")
        resized = img.resize((s, s), Image.Resampling.LANCZOS)
        resized.save(target_path, "PNG")

def main():
    torrent_img = Image.open("src-tauri/icons/torrent.png")
    magnet_img = Image.open("src-tauri/icons/magnet.png")

    # 1. Build macOS .icns and Windows .ico
    build_icns(torrent_img, "src-tauri/icons/torrent.icns")
    build_icns(magnet_img, "src-tauri/icons/magnet.icns")
    build_ico(torrent_img, "src-tauri/icons/torrent.ico")
    build_ico(magnet_img, "src-tauri/icons/magnet.ico")

    # 2. Generate Linux Hicolor PNGs
    hicolor_dir = "src-tauri/linux/icons/hicolor"
    hicolor_sizes = [16, 32, 48, 64, 128, 256]
    for base in ["application-x-bittorrent", "x-bittorrent"]:
        generate_pngs(torrent_img, base, hicolor_dir, hicolor_sizes)
    generate_pngs(magnet_img, "x-scheme-handler-magnet", hicolor_dir, hicolor_sizes)

    # 3. Generate Linux Breeze & Breeze-Dark PNGs
    breeze_sizes = [16, 22, 24, 32, 64]
    for theme in ["breeze", "breeze-dark"]:
        theme_dir = f"src-tauri/linux/icons/{theme}"
        for base in ["application-x-bittorrent", "x-bittorrent"]:
            generate_pngs(torrent_img, base, theme_dir, breeze_sizes)
        generate_pngs(magnet_img, "x-scheme-handler-magnet", theme_dir, breeze_sizes)

    # 4. Install Scalable SVGs to Hicolor, Breeze, and Breeze-Dark
    hicolor_scalable = os.path.join(hicolor_dir, "scalable", "mimetypes")
    os.makedirs(hicolor_scalable, exist_ok=True)
    shutil.copyfile("src-tauri/icons/torrent.svg", os.path.join(hicolor_scalable, "application-x-bittorrent.svg"))
    shutil.copyfile("src-tauri/icons/torrent.svg", os.path.join(hicolor_scalable, "x-bittorrent.svg"))
    shutil.copyfile("src-tauri/icons/magnet.svg", os.path.join(hicolor_scalable, "x-scheme-handler-magnet.svg"))

    for theme in ["breeze", "breeze-dark"]:
        breeze_64 = f"src-tauri/linux/icons/{theme}/mimetypes/64"
        os.makedirs(breeze_64, exist_ok=True)
        shutil.copyfile("src-tauri/icons/torrent.svg", os.path.join(breeze_64, "application-x-bittorrent.svg"))
        shutil.copyfile("src-tauri/icons/torrent.svg", os.path.join(breeze_64, "x-bittorrent.svg"))
        shutil.copyfile("src-tauri/icons/magnet.svg", os.path.join(breeze_64, "x-scheme-handler-magnet.svg"))

    print("All platform icons and scalable SVGs generated successfully.")

if __name__ == "__main__":
    main()
