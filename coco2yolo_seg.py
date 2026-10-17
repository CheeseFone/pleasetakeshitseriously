"""Convert a Roboflow COCO-Segmentation export into Ultralytics YOLO segmentation format.

Usage:  python coco2yolo_seg.py <roboflow_export_dir> <output_dir>

Input layout (Roboflow):            Output layout (YOLO):
  <in>/train/_annotations.coco.json    <out>/images/{train,valid,test}/*.jpg
  <in>/train/*.jpg                     <out>/labels/{train,valid,test}/*.txt
  <in>/valid/...  <in>/test/...        <out>/data.yaml
"""
import json, shutil, sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
names = None
splits = [s for s in ("train", "valid", "test") if (src / s / "_annotations.coco.json").exists()]
if not splits:
    sys.exit(f"No _annotations.coco.json found under {src}")

for split in splits:
    coco = json.load(open(src / split / "_annotations.coco.json"))
    # Roboflow adds an empty parent category (id 0, supercategory 'none'); only keep categories that
    # are actually used so class ids are contiguous 0..nc-1.
    used = {a["category_id"] for a in coco["annotations"]}
    cats = sorted([c for c in coco["categories"] if c["id"] in used], key=lambda c: c["id"])
    remap = {c["id"]: i for i, c in enumerate(cats)}
    split_names = [c["name"] for c in cats]
    if names is None:
        names = split_names
    elif names != split_names:
        print(f"WARNING: {split} uses classes {split_names} but train uses {names}; remapping by name")
        remap = {c["id"]: names.index(c["name"]) for c in cats}

    img_out, lbl_out = dst / "images" / split, dst / "labels" / split
    img_out.mkdir(parents=True, exist_ok=True); lbl_out.mkdir(parents=True, exist_ok=True)
    by_img = {}
    for a in coco["annotations"]:
        by_img.setdefault(a["image_id"], []).append(a)

    n_lines = 0
    for im in coco["images"]:
        w, h = im["width"], im["height"]
        shutil.copy2(src / split / im["file_name"], img_out / im["file_name"])
        lines = []
        for a in by_img.get(im["id"], []):
            seg = a["segmentation"]
            if isinstance(seg, dict):           # RLE – not handled (Roboflow polygons never are)
                continue
            for poly in seg:                    # one line per polygon
                if len(poly) < 6:
                    continue
                pts = [f"{min(max(poly[i] / (w if i % 2 == 0 else h), 0), 1):.6f}" for i in range(len(poly))]
                lines.append(f"{remap[a['category_id']]} " + " ".join(pts))
        (lbl_out / (Path(im["file_name"]).stem + ".txt")).write_text("\n".join(lines) + ("\n" if lines else ""))
        n_lines += len(lines)
    print(f"{split}: {len(coco['images'])} images, {n_lines} polygons")

yaml = [f"path: {dst.resolve()}", "train: images/train",
        f"val: images/{'valid' if 'valid' in splits else 'train'}"]
if "test" in splits:
    yaml.append("test: images/test")
yaml += ["", f"nc: {len(names)}", "names:"] + [f"  {i}: '{n}'" for i, n in enumerate(names)]
(dst / "data.yaml").write_text("\n".join(yaml) + "\n")
print(f"\nWrote {dst/'data.yaml'}:\n" + (dst / "data.yaml").read_text())
