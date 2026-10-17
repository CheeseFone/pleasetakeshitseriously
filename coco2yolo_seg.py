"""Convert a Roboflow COCO-Segmentation export into Ultralytics YOLO segmentation format.

Usage:  python coco2yolo_seg.py <roboflow_export_dir> <output_dir> [--dedupe] [--drop-unannotated] [--resplit]

  --resplit           Ignore Roboflow's split and re-split all kept photos 75/12.5/12.5 (train/valid/test),
                      stratified by each image's main class, fixed seed. Only sensible together with --dedupe.

  --dedupe            Roboflow kept photos uploaded twice ("448_jpg.rf..." and "448.rf..."). Keep one copy
                      per photo: the annotated one; if both are annotated, the one in valid/test (so the
                      evaluation sets are not leaked into train), else the "_jpg" one.
  --drop-unannotated  Drop images with no polygons (in this export every one of them is in train, and the
                      ones we could check were unlabelled stool photos, i.e. wrong "background" examples).

Input layout (Roboflow):            Output layout (YOLO):
  <in>/train/_annotations.coco.json    <out>/images/{train,valid,test}/*.jpg
  <in>/train/*.jpg                     <out>/labels/{train,valid,test}/*.txt
  <in>/valid/...  <in>/test/...        <out>/data.yaml
"""
import json, shutil, sys
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith('--')]
flags = {a for a in sys.argv[1:] if a.startswith('--')}
src, dst = Path(args[0]), Path(args[1])
splits = [s for s in ("train", "valid", "test") if (src / s / "_annotations.coco.json").exists()]
if not splits:
    sys.exit(f"No _annotations.coco.json found under {src}")
coco = {s: json.load(open(src / s / "_annotations.coco.json")) for s in splits}

# ---- which images to keep -------------------------------------------------------------------
n_ann, where = {}, {}                      # key = filename prefix before ".rf."
for s in splits:
    im = {i["id"]: i["file_name"].split(".rf.")[0] for i in coco[s]["images"]}
    for k in im.values():
        n_ann[k] = 0; where[k] = s
    for a in coco[s]["annotations"]:
        n_ann[im[a["image_id"]]] += 1
drop = set()
if "--dedupe" in flags:
    for n in {k[:-4] for k in n_ann if k.endswith("_jpg")}:
        a, b = n + "_jpg", n
        if b not in n_ann:
            continue
        if (n_ann[a] > 0) != (n_ann[b] > 0):
            loser = a if n_ann[a] == 0 else b           # keep the annotated copy
        elif where[a] != where[b] and "train" in (where[a], where[b]):
            loser = a if where[a] == "train" else b     # keep the valid/test copy
        else:
            loser = b                                   # keep the _jpg copy
        drop.add(loser)
    print(f"dedupe: dropping {len(drop)} duplicate images")
if "--drop-unannotated" in flags:
    unl = {k for k, v in n_ann.items() if v == 0} - drop
    print(f"drop-unannotated: dropping {len(unl)} images with no polygons")
    drop |= unl

# ---- optional re-split ----------------------------------------------------------------------
out_split = {k: where[k] for k in n_ann if k not in drop}
if "--resplit" in flags:
    import random
    main_cls = {}
    for sp in splits:
        im = {i["id"]: i["file_name"].split(".rf.")[0] for i in coco[sp]["images"]}
        for a in coco[sp]["annotations"]:
            main_cls.setdefault(im[a["image_id"]], []).append(a["category_id"])
    groups = {}
    for k in out_split:
        groups.setdefault(max(set(main_cls.get(k, [-1])), key=main_cls.get(k, [-1]).count), []).append(k)
    rng = random.Random(0)
    for g in groups.values():
        rng.shuffle(g)
        n = len(g); nv, nt = round(n * 0.125), round(n * 0.125)
        for i, k in enumerate(g):
            out_split[k] = "valid" if i < nv else "test" if i < nv + nt else "train"
    print("resplit:", {sp: sum(v == sp for v in out_split.values()) for sp in ("train", "valid", "test")})

# ---- convert -------------------------------------------------------------------------------
names = None
for sp in ("train", "valid", "test"):
    (dst / "images" / sp).mkdir(parents=True, exist_ok=True); (dst / "labels" / sp).mkdir(parents=True, exist_ok=True)
for split in splits:
    c = coco[split]
    used = {a["category_id"] for a in c["annotations"]}
    cats = sorted([x for x in c["categories"] if x["id"] in used], key=lambda x: x["id"])
    split_names = [x["name"] for x in cats]
    if names is None:
        names = split_names
    remap = {x["id"]: names.index(x["name"]) for x in cats}

    by_img = {}
    for a in c["annotations"]:
        by_img.setdefault(a["image_id"], []).append(a)

    n_img = n_poly = 0
    for im in c["images"]:
        key = im["file_name"].split(".rf.")[0]
        if key in drop:
            continue
        img_out, lbl_out = dst / "images" / out_split[key], dst / "labels" / out_split[key]
        w, h = im["width"], im["height"]
        shutil.copy2(src / split / im["file_name"], img_out / im["file_name"])
        lines = []
        for a in by_img.get(im["id"], []):
            seg = a["segmentation"]
            if isinstance(seg, dict):           # RLE: not produced by Roboflow polygon exports
                continue
            for poly in seg:
                if len(poly) < 6:
                    continue
                pts = [f"{min(max(poly[i] / (w if i % 2 == 0 else h), 0), 1):.6f}" for i in range(len(poly))]
                lines.append(f"{remap[a['category_id']]} " + " ".join(pts))
        (lbl_out / (Path(im["file_name"]).stem + ".txt")).write_text("\n".join(lines) + ("\n" if lines else ""))
        n_img += 1; n_poly += len(lines)
    print(f"from roboflow {split}: {n_img} images, {n_poly} polygons")

yaml = ["path: /content/dataset", "train: images/train", "val: images/valid", "test: images/test"]
yaml += ["", f"nc: {len(names)}", "names:"] + [f"  {i}: '{n}'" for i, n in enumerate(names)]
(dst / "data.yaml").write_text("\n".join(yaml) + "\n")
print(f"\nWrote {dst/'data.yaml'}")
