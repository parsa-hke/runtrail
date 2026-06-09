package diff

import (
	"math"
	"testing"
	"time"

	"github.com/runtrail/runtrail/internal/domain"
)

func makeRuns() (domain.Run, domain.Run) {
	now := time.Now()
	a := domain.Run{
		ID:        "run-a1f3c2b4",
		ProjectID: "demo",
		Name:      "resnet50-sgd",
		Status:    domain.StatusDone,
		StartedAt: now.Add(-2 * time.Hour),
		DurationS: 7200,
		HParams: map[string]any{
			"lr": 0.1, "optimizer": "sgd", "batch_size": 256, "epochs": 100,
		},
		Final: map[string]float64{
			"val_acc": 0.759, "val_loss": 0.930,
		},
	}
	b := domain.Run{
		ID:        "run-b8e2f1c3",
		ProjectID: "demo",
		Name:      "resnet50-adamw-lr3e4",
		Status:    domain.StatusDone,
		StartedAt: now.Add(-1 * time.Hour),
		DurationS: 7400,
		HParams: map[string]any{
			"lr": 0.0003, "optimizer": "adamw", "batch_size": 256, "epochs": 100,
		},
		Final: map[string]float64{
			"val_acc": 0.782, "val_loss": 0.830,
		},
	}
	return a, b
}

func TestHParamDiff(t *testing.T) {
	a, b := makeRuns()
	report := Compute([]domain.Run{a, b})
	d := report.HParams

	if _, ok := d.Changed["lr"]; !ok {
		t.Error("expected lr in changed")
	}
	if _, ok := d.Changed["optimizer"]; !ok {
		t.Error("expected optimizer in changed")
	}
	if _, ok := d.Same["batch_size"]; !ok {
		t.Error("expected batch_size in same")
	}
	if _, ok := d.Same["epochs"]; !ok {
		t.Error("expected epochs in same")
	}
}

func TestMetricsDiff(t *testing.T) {
	a, b := makeRuns()
	report := Compute([]domain.Run{a, b})
	m := report.Metrics

	if m.Winner != "B" {
		t.Errorf("expected winner B (higher val_acc), got %q", m.Winner)
	}

	var accRow *MetricSummaryRow
	for i := range m.Rows {
		if m.Rows[i].Name == "val_acc" {
			accRow = &m.Rows[i]
		}
	}
	if accRow == nil {
		t.Fatal("missing val_acc row")
	}
	if accRow.BestIdx != 1 {
		t.Errorf("best_idx for val_acc: want 1, got %d", accRow.BestIdx)
	}
	// Delta = 0.782 - 0.759 = 0.023 (approx)
	if math.Abs(accRow.Delta-0.023) > 0.001 {
		t.Errorf("delta for val_acc: want ≈0.023, got %f", accRow.Delta)
	}
}

func TestInsight_OptimizerAndLR(t *testing.T) {
	a, b := makeRuns()
	report := Compute([]domain.Run{a, b})
	ins := report.Insight

	if ins.Winner != "B" {
		t.Errorf("insight winner: want B, got %q", ins.Winner)
	}
	if ins.DeltaMetric != "val_acc" && ins.DeltaMetric != "val_loss" {
		t.Errorf("delta_metric unexpected: %q", ins.DeltaMetric)
	}
	if len(ins.Likely) == 0 {
		t.Error("expected at least one insight candidate")
	}
	// Both optimizer and LR differ → both should appear.
	found := false
	for _, l := range ins.Likely {
		if contains(l, "optimizer") || contains(l, "learning rate") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected optimizer or lr in likely causes; got %v", ins.Likely)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || (len(sub) > 0 && indexStr(s, sub) >= 0))
}

func indexStr(s, sub string) int {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
