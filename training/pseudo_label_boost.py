#!/usr/bin/env python3
"""Pseudo-label a classification-only stool dataset (Roboflow "folder structure" export) with masks
from the existing 3-group segmentation model, then merge it into an existing YOLO-seg dataset.

    python3 training/pseudo_label_boost.py <folder_export> <existing_yolo_seg_dir> <out_dir> [--merge3] [--min-score 0.3]

- For every image in <folder_export>/{train,valid,test}/<Type N>/, runs models/stool_3group_v4.onnx (any 3-group seg model via --model),
  keeps every detection with score >= --min-score, turns its mask into a polygon, and writes a YOLO
  segmentation label whose class is the FOLDER label (N-1), not the model's guess.
- Images are resized so the long side is 640 px (EXIF orientation applied) and renamed boost_<split>_<n>.jpg
  so they can be evaluated separately later.
- The existing YOLO-seg dataset is copied in unchanged. Roboflow's train/valid/test split for the
  boost set is kept, so valid+test contain real-world photos the model never trains on.
- --merge3 maps classes to 0 constipated (1-2), 1 normal (3-5), 2 loose (6-7) for the 3-group model.
Requires: numpy, pillow, onnxruntime, opencv-python-headless.
"""
import argparse, os, re, shutil, sys, json
import numpy as np, cv2, onnxruntime as ort
from PIL import Image, ImageOps

ap = argparse.ArgumentParser()
ap.add_argument('folder_export'); ap.add_argument('existing'); ap.add_argument('out')
ap.add_argument('--merge3', action='store_true'); ap.add_argument('--min-score', type=float, default=0.3)
ap.add_argument('--model', default=os.path.join(os.path.dirname(__file__), '..', 'models', 'stool_3group_v4.onnx'))
ap.add_argument('--preview', default=None, help='dir to write a few overlay previews for sanity checking')
a = ap.parse_args()

sess = ort.InferenceSession(a.model, providers=['CPUExecutionProvider'])
INPUT = 640
def infer(img):
    x = np.asarray(img.resize((INPUT, INPUT)).convert('RGB'), dtype=np.float32) / 255.0
    o0, o1 = sess.run(None, {'images': x.transpose(2, 0, 1)[None]})
    dets = o0[0]; dets = dets[dets[:, 4] >= a.min_score]
    return dets[np.argsort(-dets[:, 4])], o1[0]  # protos [32,160,160]

def mask_polygon(det, protos):
    coeffs = det[6:]; m = (coeffs[:, None, None] * protos).sum(0)
    m = 1 / (1 + np.exp(-m))
    s = protos.shape[1] / INPUT
    x1, y1, x2, y2 = [int(v * s) for v in det[:4]]
    crop = np.zeros_like(m); crop[max(0, y1):y2 + 1, max(0, x1):x2 + 1] = m[max(0, y1):y2 + 1, max(0, x1):x2 + 1]
    binm = (cv2.resize(crop, (INPUT, INPUT), interpolation=cv2.INTER_LINEAR) > 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(binm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts: return None
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < 50: return None
    c = cv2.approxPolyDP(c, 1.5, True).reshape(-1, 2)
    if len(c) < 3: return None
    return np.clip(c / INPUT, 0, 1)

def cls_of(n): return ({1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2}[n]) if a.merge3 else n - 1

# 1. copy existing dataset
for sub in ['images', 'labels']:
    for split in ['train', 'valid', 'test']:
        src = os.path.join(a.existing, sub, split); dst = os.path.join(a.out, sub, split)
        os.makedirs(dst, exist_ok=True)
        for f in os.listdir(src): shutil.copy2(os.path.join(src, f), dst)
if a.preview: os.makedirs(a.preview, exist_ok=True)

# 2. pseudo-label the boost set
stats = {'images': 0, 'labelled': 0, 'no_detection': 0, 'instances': 0, 'skipped_folders': []}
previews = 0
for split in ['train', 'valid', 'test']:
    sdir = os.path.join(a.folder_export, split)
    if not os.path.isdir(sdir): continue
    n = 0
    for folder in sorted(os.listdir(sdir)):
        m = re.match(r'Type\s*(\d)', folder)
        if not m: stats['skipped_folders'].append(f'{split}/{folder}'); continue
        ty = int(m.group(1)); cls = cls_of(ty)
        for f in sorted(os.listdir(os.path.join(sdir, folder))):
            if not re.search(r'\.(jpe?g|png|webp)$', f, re.I): continue
            stats['images'] += 1
            try: img = ImageOps.exif_transpose(Image.open(os.path.join(sdir, folder, f))).convert('RGB')
            except Exception as e: print('skip', f, e); continue
            dets, protos = infer(img)
            polys = [p for p in (mask_polygon(d, protos) for d in dets[:6]) if p is not None]
            if not polys: stats['no_detection'] += 1; continue
            # resize long side to 640 and save
            scale = 640 / max(img.size); img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
            n += 1; name = f'boost_{split}_{n:03d}'
            img.save(os.path.join(a.out, 'images', split, name + '.jpg'), quality=92)
            with open(os.path.join(a.out, 'labels', split, name + '.txt'), 'w') as fh:
                for p in polys: fh.write(f'{cls} ' + ' '.join(f'{x:.5f} {y:.5f}' for x, y in p) + '\n')
            stats['labelled'] += 1; stats['instances'] += len(polys)
            if a.preview and previews < 24 and split == 'train':
                ov = np.array(img).copy()
                for p in polys:
                    pts = (p * [img.width, img.height]).astype(np.int32)
                    cv2.polylines(ov, [pts], True, (255, 0, 0), 2)
                cv2.putText(ov, f'type {ty} ({len(polys)} inst, top {dets[0][4]:.2f})', (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
                Image.fromarray(ov).save(os.path.join(a.preview, f'{name}_t{ty}.jpg'), quality=80); previews += 1

# 3. data.yaml
names = ['constipated_1-2', 'normal_3-5', 'loose_6-7'] if a.merge3 else [str(i) for i in range(1, 8)]
with open(os.path.join(a.out, 'data.yaml'), 'w') as fh:
    fh.write('path: /content/dataset\ntrain: images/train\nval: images/valid\ntest: images/test\n\n')
    fh.write(f'nc: {len(names)}\nnames:\n' + ''.join(f"  {i}: '{n}'\n" for i, n in enumerate(names)))
for split in ['train', 'valid', 'test']:
    stats[split] = len(os.listdir(os.path.join(a.out, 'images', split)))
print(json.dumps(stats, indent=1))
