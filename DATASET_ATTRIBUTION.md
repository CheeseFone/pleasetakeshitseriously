# Dataset attribution

The model in this project was trained on the **"stool classification"** dataset (v1, 2025-11-15),
published by user *smartgut* on Roboflow Universe:
https://universe.roboflow.com/smartgut/stool-classification-uvnqx

Licensed under **Creative Commons Attribution 4.0 International (CC BY 4.0)**:
https://creativecommons.org/licenses/by/4.0/

Changes made: annotations converted from COCO Segmentation to Ultralytics YOLO segmentation format
(`coco2yolo_seg.py`); the unused parent category "stool" was removed, leaving classes 1–7.

# Disclaimer

This project classifies stool images using the Bristol Stool Scale for informational and
educational purposes only. It is **not medical advice**, is not a medical device, and has not been
reviewed by any health authority. Model output may be wrong. Do not use it to diagnose, treat, or
make decisions about any health condition; consult a qualified healthcare professional for medical
concerns. Images are processed on your device and are not uploaded.
