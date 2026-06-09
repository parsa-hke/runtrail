/* global window */
// Deterministic PRNG so charts don't reshuffle each render.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLoss(seed, n, start, end, noise = 0.04) {
  const r = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // exponential-ish decay with jitter
    const base = end + (start - end) * Math.exp(-3.2 * t);
    const wobble = (r() - 0.5) * noise * (start - end);
    out.push(Math.max(0.001, base + wobble));
  }
  return out;
}
function makeAcc(seed, n, start, end, noise = 0.012) {
  const r = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const base = start + (end - start) * (1 - Math.exp(-2.6 * t));
    const wobble = (r() - 0.5) * noise;
    out.push(Math.min(0.999, Math.max(0, base + wobble)));
  }
  return out;
}
function makeGPU(seed, n, base = 0.86, dips = true) {
  const r = mulberry32(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    let v = base + (r() - 0.5) * 0.05;
    if (dips && i % 47 < 3) v -= 0.35 * r();
    out.push(Math.max(0.02, Math.min(0.99, v)));
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
const RUNS = [
  {
    id: "run-a1f3",
    name: "resnet50-aug-cosine",
    status: "done",
    started: "2026-05-11 14:22:01",
    ended:   "2026-05-11 19:48:33",
    duration: 19_592,
    user: "jules",
    branch: "main",
    commit: "8c2a91b",
    tags: ["baseline", "imagenet", "v3"],
    pinned: true,
    hparams: {
      optimizer: "sgd",
      lr: 0.1,
      momentum: 0.9,
      weight_decay: 1e-4,
      batch_size: 256,
      epochs: 90,
      scheduler: "cosine",
      warmup_epochs: 5,
      seed: 42,
      mixed_precision: true,
      augment: "randaug-m9",
    },
    metrics: {
      train_loss:  { unit: "",  best: 0.612, last: 0.612, series: makeLoss(11, 200, 6.9, 0.61) },
      val_loss:    { unit: "",  best: 0.84,  last: 0.93,  series: makeLoss(12, 200, 6.5, 0.93, 0.06) },
      train_acc:   { unit: "%", best: 0.781, last: 0.781, series: makeAcc(13, 200, 0.001, 0.781) },
      val_acc:     { unit: "%", best: 0.762, last: 0.759, series: makeAcc(14, 200, 0.002, 0.759, 0.015) },
      lr:          { unit: "",  best: 0.1,   last: 0.0001,series: makeLoss(15, 200, 0.1, 0.0001, 0) },
    },
    final: { val_acc: 0.759, val_loss: 0.93, top5: 0.927 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4, cpu: "AMD EPYC 7763 64-Core", ram: "512 GiB", os: "Ubuntu 22.04 LTS" },
    env: { python: "3.11.7", torch: "2.3.1+cu121", cuda: "12.1", numpy: "1.26.4" },
    dataset: "imagenet-1k", dataset_hash: "sha256:7af3…b29c",
    cmd: "python train.py --config configs/resnet50_imagenet.yaml --epochs 90 --lr 0.1",
    notes: "Baseline for the imagenet sweep. **Reference run** — pinned. Mixed precision on; cosine schedule with 5-epoch linear warmup.",
  },
  {
    id: "run-b8e2",
    name: "resnet50-aug-cosine-lr3e4",
    status: "done",
    started: "2026-05-12 09:12:47",
    ended:   "2026-05-12 14:31:18",
    duration: 19_111,
    user: "jules",
    branch: "exp/lr-sweep",
    commit: "3f019dc",
    tags: ["imagenet", "lr-sweep"],
    pinned: false,
    hparams: {
      optimizer: "adamw",
      lr: 3e-4,
      momentum: null,
      weight_decay: 5e-2,
      batch_size: 256,
      epochs: 90,
      scheduler: "cosine",
      warmup_epochs: 5,
      seed: 137,
      mixed_precision: true,
      augment: "randaug-m9",
    },
    metrics: {
      train_loss: { unit: "", best: 0.521, last: 0.521, series: makeLoss(21, 200, 6.8, 0.52) },
      val_loss:   { unit: "", best: 0.79,  last: 0.83,  series: makeLoss(22, 200, 6.4, 0.83, 0.05) },
      train_acc:  { unit: "%",best: 0.804, last: 0.804, series: makeAcc(23, 200, 0.001, 0.804) },
      val_acc:    { unit: "%",best: 0.785, last: 0.782, series: makeAcc(24, 200, 0.002, 0.782, 0.013) },
      lr:         { unit: "", best: 3e-4,  last: 3e-7,  series: makeLoss(25, 200, 3e-4, 3e-7, 0) },
    },
    final: { val_acc: 0.782, val_loss: 0.83, top5: 0.939 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4, cpu: "AMD EPYC 7763 64-Core", ram: "512 GiB", os: "Ubuntu 22.04 LTS" },
    env: { python: "3.11.7", torch: "2.3.1+cu121", cuda: "12.1", numpy: "1.26.4" },
    dataset: "imagenet-1k", dataset_hash: "sha256:7af3…b29c",
    cmd: "python train.py --config configs/resnet50_imagenet.yaml --optimizer adamw --lr 3e-4 --weight-decay 5e-2",
    notes: "AdamW @ 3e-4 with weight decay 5e-2. **+2.3% val_acc vs baseline.**",
  },
  {
    id: "run-c552",
    name: "resnet50-mixup-0.2",
    status: "done",
    started: "2026-05-12 16:04:11",
    ended:   "2026-05-12 21:12:42",
    duration: 18_511,
    user: "ada",
    branch: "exp/mixup",
    commit: "a91b002",
    tags: ["imagenet", "mixup"],
    hparams: { optimizer: "sgd", lr: 0.1, momentum: 0.9, weight_decay: 1e-4, batch_size: 256, epochs: 90, scheduler: "cosine", mixup: 0.2, seed: 42, mixed_precision: true },
    metrics: {
      train_loss: { unit: "", best: 0.701, last: 0.701, series: makeLoss(31, 200, 6.9, 0.70) },
      val_loss:   { unit: "", best: 0.81,  last: 0.88,  series: makeLoss(32, 200, 6.4, 0.88, 0.05) },
      val_acc:    { unit: "%",best: 0.769, last: 0.768, series: makeAcc(34, 200, 0.002, 0.768, 0.013) },
    },
    final: { val_acc: 0.768, val_loss: 0.88, top5: 0.931 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    env: { python: "3.11.7", torch: "2.3.1+cu121" },
    dataset: "imagenet-1k",
  },
  {
    id: "run-d77a",
    name: "vit-b16-imagenet-baseline",
    status: "running",
    started: "2026-05-13 08:14:32",
    ended: null,
    duration: 6_240,
    progress: 0.41,
    eta: "3h 27m",
    user: "ada",
    branch: "exp/vit",
    commit: "1c4b6e1",
    tags: ["imagenet", "vit"],
    hparams: { optimizer: "adamw", lr: 1e-3, weight_decay: 0.05, batch_size: 1024, epochs: 300, scheduler: "cosine", warmup_epochs: 20, seed: 0, mixed_precision: true, augment: "randaug-m9 + mixup-0.2" },
    metrics: {
      train_loss: { unit: "", best: 1.91, last: 2.04, series: makeLoss(41, 124, 6.9, 2.0) },
      val_loss:   { unit: "", best: 2.21, last: 2.31, series: makeLoss(42, 124, 6.4, 2.3, 0.05) },
      val_acc:    { unit: "%",best: 0.521, last: 0.508, series: makeAcc(44, 124, 0.002, 0.508, 0.018) },
    },
    final: { val_acc: 0.508, val_loss: 2.31, top5: 0.781 },
    hardware: { gpu: "NVIDIA H100 80GB", count: 8 },
    env: { python: "3.11.7", torch: "2.3.1+cu121" },
    dataset: "imagenet-1k",
  },
  {
    id: "run-e0a4",
    name: "vit-b16-imagenet-lr5e4",
    status: "running",
    started: "2026-05-13 09:01:17",
    ended: null,
    duration: 3_450,
    progress: 0.22,
    eta: "4h 12m",
    user: "ada",
    branch: "exp/vit",
    commit: "1c4b6e1",
    tags: ["imagenet", "vit", "lr-sweep"],
    hparams: { optimizer: "adamw", lr: 5e-4, weight_decay: 0.05, batch_size: 1024 },
    metrics: {
      train_loss: { unit: "", best: 2.31, last: 2.42, series: makeLoss(51, 70, 6.9, 2.4) },
      val_loss:   { unit: "", best: 2.62, last: 2.71, series: makeLoss(52, 70, 6.4, 2.7, 0.05) },
      val_acc:    { unit: "%",best: 0.401, last: 0.391, series: makeAcc(54, 70, 0.002, 0.391, 0.018) },
    },
    final: { val_acc: 0.391 },
    hardware: { gpu: "NVIDIA H100 80GB", count: 8 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-f7c1",
    name: "resnet50-bf16-batch512",
    status: "failed",
    started: "2026-05-11 11:02:01",
    ended:   "2026-05-11 11:06:42",
    duration: 281,
    user: "jules",
    branch: "main",
    commit: "8c2a91b",
    tags: ["imagenet"],
    error: "RuntimeError: CUDA out of memory. Tried to allocate 4.21 GiB",
    hparams: { optimizer: "sgd", lr: 0.1, batch_size: 512, mixed_precision: "bf16" },
    metrics: {
      train_loss: { unit: "", best: 6.84, last: 6.84, series: makeLoss(61, 12, 6.95, 6.8) },
    },
    final: {},
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-g3b8",
    name: "resnet50-sgd-momentum-95",
    status: "killed",
    started: "2026-05-10 22:11:00",
    ended:   "2026-05-11 02:43:18",
    duration: 16_338,
    user: "jules",
    branch: "exp/sgd-sweep",
    commit: "a02fa11",
    tags: ["imagenet", "lr-sweep"],
    hparams: { optimizer: "sgd", lr: 0.2, momentum: 0.95, batch_size: 256 },
    metrics: {
      train_loss: { unit: "", best: 0.92, last: 0.92, series: makeLoss(71, 110, 6.9, 0.92) },
      val_acc:    { unit: "%",best: 0.711, last: 0.708, series: makeAcc(74, 110, 0.002, 0.708, 0.018) },
    },
    final: { val_acc: 0.708 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-h2dd",
    name: "convnext-tiny-baseline",
    status: "done",
    started: "2026-05-09 18:30:55",
    ended:   "2026-05-10 04:11:09",
    duration: 34_814,
    user: "ada",
    branch: "exp/convnext",
    commit: "5e7c1f0",
    tags: ["imagenet", "convnext"],
    hparams: { optimizer: "adamw", lr: 4e-3, weight_decay: 0.05, batch_size: 1024, epochs: 300, scheduler: "cosine" },
    metrics: {
      train_loss: { unit: "", best: 0.83, last: 0.83, series: makeLoss(81, 200, 6.9, 0.83) },
      val_loss:   { unit: "", best: 0.91, last: 0.97, series: makeLoss(82, 200, 6.4, 0.97, 0.05) },
      val_acc:    { unit: "%",best: 0.791, last: 0.789, series: makeAcc(84, 200, 0.002, 0.789, 0.013) },
    },
    final: { val_acc: 0.789, val_loss: 0.97, top5: 0.942 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-i9e5",
    name: "resnet50-cutmix-1.0",
    status: "done",
    started: "2026-05-08 12:14:00",
    ended:   "2026-05-08 17:39:51",
    duration: 19_491,
    user: "ada",
    branch: "exp/cutmix",
    commit: "20bb1ac",
    tags: ["imagenet", "cutmix"],
    hparams: { optimizer: "sgd", lr: 0.1, momentum: 0.9, cutmix: 1.0, batch_size: 256 },
    metrics: {
      train_loss: { unit: "", best: 0.72, last: 0.72, series: makeLoss(91, 200, 6.9, 0.72) },
      val_acc:    { unit: "%",best: 0.771, last: 0.769, series: makeAcc(94, 200, 0.002, 0.769, 0.013) },
    },
    final: { val_acc: 0.769, top5: 0.934 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-j4ce",
    name: "resnet50-labelsmooth-0.1",
    status: "done",
    started: "2026-05-07 09:00:12",
    ended:   "2026-05-07 14:21:00",
    duration: 19_248,
    user: "jules",
    branch: "exp/regularize",
    commit: "9aa1112",
    tags: ["imagenet", "labelsmooth"],
    hparams: { optimizer: "sgd", lr: 0.1, label_smoothing: 0.1, batch_size: 256 },
    metrics: {
      train_loss: { unit: "", best: 1.32, last: 1.32, series: makeLoss(101, 200, 6.9, 1.32) },
      val_acc:    { unit: "%",best: 0.766, last: 0.764, series: makeAcc(104, 200, 0.002, 0.764, 0.013) },
    },
    final: { val_acc: 0.764, top5: 0.929 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-k7f0",
    name: "resnet50-ema-0.999",
    status: "done",
    started: "2026-05-06 14:30:55",
    ended:   "2026-05-06 19:48:41",
    duration: 19_066,
    user: "jules",
    branch: "exp/ema",
    commit: "0bb3a8c",
    tags: ["imagenet", "ema"],
    hparams: { optimizer: "sgd", lr: 0.1, ema_decay: 0.999, batch_size: 256 },
    metrics: {
      train_loss: { unit: "", best: 0.65, last: 0.65, series: makeLoss(111, 200, 6.9, 0.65) },
      val_acc:    { unit: "%",best: 0.773, last: 0.772, series: makeAcc(114, 200, 0.002, 0.772, 0.013) },
    },
    final: { val_acc: 0.772, top5: 0.935 },
    hardware: { gpu: "NVIDIA A100 80GB", count: 4 },
    dataset: "imagenet-1k",
  },
  {
    id: "run-l1a2",
    name: "scratch-tiny-debug",
    status: "killed",
    started: "2026-05-06 09:00:00",
    ended:   "2026-05-06 09:04:11",
    duration: 251,
    user: "ada",
    branch: "wip",
    commit: "DIRTY",
    tags: ["debug"],
    hparams: { optimizer: "adam", lr: 1e-3, batch_size: 16 },
    metrics: { train_loss: { unit: "", best: 2.51, last: 2.51, series: makeLoss(121, 12, 4.0, 2.5) } },
    final: {},
    hardware: { gpu: "NVIDIA A100 80GB", count: 1 },
    dataset: "imagenet-1k-mini",
  },
];

// Artifacts for run-b8e2
const ARTIFACTS_B = [
  { name: "best.ckpt",        type: "checkpoint", size: 102_400_000 },
  { name: "final.ckpt",       type: "checkpoint", size: 102_400_000 },
  { name: "config.yaml",      type: "yaml",       size: 1_812 },
  { name: "train.log",        type: "text",       size: 244_010 },
  { name: "conf_matrix.png",  type: "image",      size: 84_213 },
  { name: "lr_schedule.png",  type: "image",      size: 21_009 },
  { name: "predictions.json", type: "json",       size: 5_220_113 },
];

// Resource series for run-b8e2 (n=200 across full duration)
const RESOURCES_B = {
  gpu_util:  makeGPU(201, 200, 0.94, false),
  gpu_mem:   makeGPU(202, 200, 0.81, false),
  cpu:       makeGPU(203, 200, 0.42, true),
  ram:       makeGPU(204, 200, 0.63, false),
  io_read:   makeGPU(205, 200, 0.18, true),
};

// Packages diff between baseline (run-a) and run-b
const PACKAGES_A = [
  ["torch", "2.3.1+cu121"], ["torchvision", "0.18.1"], ["numpy", "1.26.4"],
  ["pillow", "10.3.0"], ["scipy", "1.13.1"], ["pandas", "2.2.2"], ["timm", "1.0.7"],
  ["wandb", "0.17.0"], ["pyyaml", "6.0.1"], ["tqdm", "4.66.4"], ["einops", "0.8.0"],
  ["transformers", "4.41.2"], ["accelerate", "0.30.1"], ["pyarrow", "16.1.0"],
];
const PACKAGES_B = [
  ["torch", "2.3.1+cu121"], ["torchvision", "0.18.1"], ["numpy", "1.26.4"],
  ["pillow", "10.3.0"], ["scipy", "1.13.1"], ["pandas", "2.2.2"], ["timm", "1.0.9"],
  ["wandb", "0.17.0"], ["pyyaml", "6.0.1"], ["tqdm", "4.66.4"], ["einops", "0.8.0"],
  ["transformers", "4.42.4"], ["accelerate", "0.31.0"], ["pyarrow", "16.1.0"],
];

const FILE_TREE_B = [
  { path: "configs/", kind: "dir" },
  { path: "configs/resnet50_imagenet.yaml", kind: "file", size: 1_812 },
  { path: "configs/sched/cosine.yaml", kind: "file", size: 412 },
  { path: "src/", kind: "dir" },
  { path: "src/train.py", kind: "file", size: 14_220 },
  { path: "src/data/imagenet.py", kind: "file", size: 6_104 },
  { path: "src/models/resnet.py", kind: "file", size: 8_822 },
  { path: "src/optim/adamw.py", kind: "file", size: 1_904 },
  { path: "src/utils/checkpoint.py", kind: "file", size: 2_201 },
  { path: "train.py", kind: "file", size: 412 },
  { path: "requirements.txt", kind: "file", size: 802 },
  { path: "README.md", kind: "file", size: 2_140 },
];

const TRAIN_PY_SNIPPET = `# src/train.py — captured at commit 3f019dc
import torch
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR

from data.imagenet import build_loaders
from models.resnet import resnet50
from utils.checkpoint import save_checkpoint

def train(cfg):
    model = resnet50(num_classes=1000).cuda()
    opt = AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = CosineAnnealingLR(opt, T_max=cfg.epochs, eta_min=cfg.lr * 1e-3)

    train_loader, val_loader = build_loaders(cfg)
    scaler = torch.cuda.amp.GradScaler()

    for epoch in range(cfg.epochs):
        model.train()
        for step, (x, y) in enumerate(train_loader):
            x, y = x.cuda(non_blocking=True), y.cuda(non_blocking=True)
            with torch.cuda.amp.autocast(dtype=torch.float16):
                logits = model(x)
                loss = torch.nn.functional.cross_entropy(logits, y, label_smoothing=0.1)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.step(opt)
            scaler.update()
        sched.step()
        evaluate(model, val_loader, epoch)
        save_checkpoint(model, opt, epoch, cfg)`;

const DIFF_HUNK = `--- a/src/train.py
+++ b/src/train.py
@@ -3,9 +3,9 @@
 import torch
-from torch.optim import SGD
-from torch.optim.lr_scheduler import MultiStepLR
+from torch.optim import AdamW
+from torch.optim.lr_scheduler import CosineAnnealingLR

 from data.imagenet import build_loaders
 from models.resnet import resnet50
@@ -18,11 +18,11 @@
 def train(cfg):
     model = resnet50(num_classes=1000).cuda()
-    opt = SGD(model.parameters(), lr=cfg.lr, momentum=0.9, weight_decay=1e-4)
-    sched = MultiStepLR(opt, milestones=[30, 60, 80], gamma=0.1)
+    opt = AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
+    sched = CosineAnnealingLR(opt, T_max=cfg.epochs, eta_min=cfg.lr * 1e-3)

     train_loader, val_loader = build_loaders(cfg)
     scaler = torch.cuda.amp.GradScaler()`;

const PROJECT = {
  name: "vision-bench",
  path: "/Users/jules/work/vision-bench",
  description: "ImageNet ablations, regularization sweeps, and ViT scaling.",
  default_tags: ["imagenet"],
  storage: 184.2 * 1024 * 1024 * 1024, // bytes
  storage_breakdown: { runs: 18.4, artifacts: 154.1, snapshots: 11.7 }, // GiB
  members: ["jules", "ada", "morgan", "riku"],
  baselines: ["run-a1f3", "run-h2dd"],
  saved_views: [
    { id: "v1", name: "imagenet · top runs", count: 12 },
    { id: "v2", name: "running now",         count: 2 },
    { id: "v3", name: "failed (last 7d)",    count: 3 },
    { id: "v4", name: "ada / vit sweep",     count: 5 },
  ],
};

const SHORTCUTS = [
  ["Navigation", [
    ["g h", "Go to run list"],
    ["g s", "Go to settings"],
    ["g l", "Go to live runs"],
    ["esc", "Back / close"],
    ["?", "Show this overlay"],
  ]],
  ["Run list", [
    ["j / k", "Move down / up"],
    ["x",     "Toggle row selection"],
    ["enter", "Open selected run"],
    ["c",     "Compare selected runs"],
    ["/",     "Focus search"],
    ["p",     "Pin run"],
    ["t",     "Add tag"],
  ]],
  ["Run detail", [
    ["1 – 6", "Switch tabs"],
    ["[ / ]", "Prev / next run"],
    ["e",     "Edit name"],
    ["n",     "Add note"],
  ]],
  ["Diff view", [
    ["s",   "Swap sides"],
    ["d",   "Show only differences"],
    ["g c", "Jump to code diff"],
  ]],
];

window.RT_DATA = {
  RUNS, ARTIFACTS_B, RESOURCES_B, PACKAGES_A, PACKAGES_B,
  FILE_TREE_B, TRAIN_PY_SNIPPET, DIFF_HUNK, PROJECT, SHORTCUTS,
  mulberry32,
};
