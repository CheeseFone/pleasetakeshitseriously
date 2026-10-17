# Stool classifier (Bristol scale) – models + training

Everything needed to train, evaluate and ship the browser-side segmentation models. No web app yet.

## Layout

```
models/     stool_3group.onnx / .pt   3-class model: constipated / normal / loose   (ship this one)
            stool_v3.onnx / .pt       7-class model: Bristol types 1–7             (secondary hint)
data/       stool_yolo_seg_v3_640.zip         clean 7-class YOLO dataset (865 photos, 640 px)
            stool_yolo_seg_v3_640_3group.zip  same photos, labels merged to 3 groups
            raw/                              original Roboflow fork export (COCO)
training/   train_yolo26_seg_colab_v3_640.ipynb   Colab notebook, 7-class
            train_yolo26_seg_colab_3group.ipynb   Colab notebook, 3-class
            coco2yolo_seg.py                      Roboflow COCO -> YOLO converter (dedupe, resplit, merge3)
docs/       DATASET_ATTRIBUTION.md   CC BY 4.0 credit text + medical disclaimer (must appear in the app)
```

## Model contract (both ONNX files, YOLO26n-seg, end-to-end head, no NMS needed)

| | |
|---|---|
| input | `images` float32 `[1, 3, 640, 640]`, RGB, NCHW, pixel/255, photo stretched to 640×640 |
| output0 | float32 `[1, 300, 38]` – per detection: `x1, y1, x2, y2, score, class_id, 32 mask coeffs` (pixels in the 640 input) |
| output1 | float32 `[1, 32, 160, 160]` – mask prototypes |
| threshold | keep rows with `score > 0.2` (lower than the usual 0.25: the models under-detect, not over-detect) |
| mask | `sigmoid(coeffs · output1[0].reshape(32, -1))` -> 160×160, crop to box/4, upscale to display |
| file size | 11 MB each, opset 17, fp32, fixed shape (onnxruntime-web, wasm or webgpu) |

Class ids:
- `stool_3group`: 0 = constipated (types 1–2), 1 = normal (3–5), 2 = loose (6–7)
- `stool_v3`: 0..6 = Bristol type 1..7

## Measured accuracy (108 unseen test photos, same photos for both models, conf > 0.2)

| | 3-group | 7-class |
|---|---|---|
| per photo, top detection correct | **85 %** | 69 % |
| per photo, within ±1 Bristol type | – | 82 % |
| photos with no detection | 0 % | 2 % |
| per labelled instance localized (IoU > 0.5) | 76 % | 76 % |
| CPU inference (onnxruntime, laptop) | ~145 ms | ~160 ms |

7-class is strong on types 1, 6, 7 (91–93 % when found) and weak on 2–5 (43–64 %). Type 2 is mostly called 3; type 4 splits between 2 and 3.
The 3-group model's errors are almost all between neighbouring groups (constipated↔normal, normal↔loose); no constipated↔loose confusion.

Numbers come from `onnxruntime` on the exported ONNX files, i.e. the exact artefacts the browser will run.

## App behaviour (tested by simulating the policy on the 108 test photos)
- **Headline** = class of the highest-score detection from `stool_3group`, threshold 0.2. 85 % correct, an answer on 100 % of photos.
  Raising the threshold to 0.5 gives 88 % correct but no answer on 7 % of photos; not worth it.
- **"Likely type N"** from `stool_v3`, shown only when its score ≥ 0.6 **and** the type falls inside the headline group.
  Shown on 83 % of photos, 78 % exact, ~88 % within one type. (Showing it whenever score ≥ 0.5 was 73 % exact; the agreement check matters more than the threshold.)
- **Mask overlay**: the decode formula above gives median IoU 0.91 against the labels. Draw the mask for *every* kept detection, not just the top one;
  type-1 photos have many small lumps and a single mask misses most of them.
- **Phone photos are not square**: stretching the 3:4 camera frame to 640×640 scored the same as letterboxing or centre-cropping (85 / 83 / 85 %).
  Stretch is simplest, and box/mask coordinates map back by scaling x by W/640 and y by H/640.
- Disclaimer from `docs/DATASET_ATTRIBUTION.md` on screen.

## Hosting notes
- Fully client-side; any static host works. Cloudflare Pages preferred (unlimited bandwidth, custom headers for multi-threaded WASM and long-lived model caching). GitHub Pages works but cannot set headers.
- Cache the model with the Cache API; iOS Safari wipes site storage after 7 days unless installed as a PWA.
- Models are under GitHub's 100 MB limit: commit directly, do not use Git LFS (Pages serves LFS pointers as text).

## Retraining
Upload a notebook from `training/` to Colab, pick an A100 or L4, upload the matching zip from `data/` when asked (it is copied to Drive once).
To rebuild the zips from a new Roboflow export:
```
python3 training/coco2yolo_seg.py <export_dir> <out_dir> --dedupe --drop-unannotated --resplit [--merge3]
```
