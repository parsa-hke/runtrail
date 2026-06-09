// Package diff implements the run comparison engine.
// It is pure Go with no I/O; it takes pre-loaded domain.Run values and returns
// a DiffReport that the CLI and HTTP handler can render.
package diff

import (
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/parsa-hke/runtrail/internal/domain"
)

// ── Public types ─────────────────────────────────────────────────────────────

// DiffReport is the full comparison of N runs (N ≥ 2).
type DiffReport struct {
	Runs     []domain.Run `json:"runs"`
	HParams  HParamDiff   `json:"hparams"`
	Metrics  MetricsDiff  `json:"metrics"`
	Env      EnvDiff      `json:"env"`
	Hardware HardwareDiff `json:"hardware"`
	Data     DataDiff     `json:"data"`
	Insight  Insight      `json:"insight"`
}

// HParamDiff classifies hyperparameter keys across all runs.
// Values slices always have len == number of runs; nil entry means "absent".
type HParamDiff struct {
	// Changed: keys whose values differ across any pair of runs.
	Changed map[string][]any `json:"changed"`
	// Same: keys with identical values across all runs.
	Same map[string]any `json:"same"`
	// OnlyIn: keys present in only some runs; maps key → run indices that have it.
	OnlyIn map[string][]int `json:"only_in"`
}

// MetricsDiff compares final metrics.
type MetricsDiff struct {
	// Winner is "A" | "B" | "tie" for 2-run diffs; empty for N-way.
	Winner string             `json:"winner"`
	Rows   []MetricSummaryRow `json:"rows"`
}

// MetricSummaryRow holds per-metric comparison data.
type MetricSummaryRow struct {
	Name         string    `json:"name"`
	Values       []float64 `json:"values"`    // NaN when run lacks this metric
	BestIdx      int       `json:"best_idx"`  // index of best run; -1 if tied / unknown
	Delta        float64   `json:"delta"`     // values[1] - values[0] (2-run only; NaN otherwise)
	DeltaPct     float64   `json:"delta_pct"` // % change; NaN if values[0] == 0
	HigherBetter bool      `json:"higher_better"`
}

// EnvDiff compares env (Python version, packages, CUDA, …).
type EnvDiff struct {
	Changed map[string][]string `json:"changed"` // key → [val_run0, val_run1, …]
	Same    map[string]string   `json:"same"`
}

// HardwareDiff compares hardware fields.
type HardwareDiff struct {
	Changed map[string][]string `json:"changed"`
	Same    map[string]string   `json:"same"`
}

// DataDiff compares dataset identities.
type DataDiff struct {
	Same     bool     `json:"same"`
	SameHash bool     `json:"same_hash"`
	Values   []string `json:"values"` // dataset name per run
	Hashes   []string `json:"hashes"` // hash per run
}

// Insight holds the smart-highlight heuristics (FR-4.3).
type Insight struct {
	Winner      string   `json:"winner"`       // "A" | "B" | "tie"
	DeltaMetric string   `json:"delta_metric"` // e.g. "val_acc"
	DeltaValue  float64  `json:"delta_value"`
	DeltaPct    float64  `json:"delta_pct"`
	Likely      []string `json:"likely"`     // ranked explanation candidates
	Confidence  float64  `json:"confidence"` // 0..1
}

// ── Entry point ───────────────────────────────────────────────────────────────

// Compute produces a DiffReport for 2 or more runs.
func Compute(runs []domain.Run) DiffReport {
	r := DiffReport{Runs: runs}
	if len(runs) == 0 {
		return r
	}
	r.HParams = computeHParamDiff(runs)
	r.Metrics = computeMetricsDiff(runs)
	r.Env = computeEnvDiff(runs)
	r.Hardware = computeHWDiff(runs)
	r.Data = computeDataDiff(runs)
	if len(runs) >= 2 {
		r.Insight = computeInsight(runs, r)
	}
	return r
}

// ── HParams ──────────────────────────────────────────────────────────────────

func computeHParamDiff(runs []domain.Run) HParamDiff {
	keySet := map[string]struct{}{}
	for _, r := range runs {
		for k := range r.HParams {
			keySet[k] = struct{}{}
		}
	}
	d := HParamDiff{
		Changed: map[string][]any{},
		Same:    map[string]any{},
		OnlyIn:  map[string][]int{},
	}
	for k := range keySet {
		vals := make([]any, len(runs))
		presentIn := []int{}
		for i, r := range runs {
			if v, ok := r.HParams[k]; ok {
				vals[i] = v
				presentIn = append(presentIn, i)
			}
		}
		if len(presentIn) < len(runs) {
			d.OnlyIn[k] = presentIn
			d.Changed[k] = vals
			continue
		}
		ref := fmt.Sprintf("%v", vals[0])
		same := true
		for _, v := range vals[1:] {
			if fmt.Sprintf("%v", v) != ref {
				same = false
				break
			}
		}
		if same {
			d.Same[k] = vals[0]
		} else {
			d.Changed[k] = vals
		}
	}
	return d
}

// ── Metrics ──────────────────────────────────────────────────────────────────

// higherBetterNames: suffixes/names where higher value = better result.
var higherBetterNames = []string{"acc", "accuracy", "precision", "recall", "f1", "auc", "r2", "score", "map", "bleu", "rouge"}

// lowerBetterNames: suffixes/names where lower value = better result.
var lowerBetterNames = []string{"loss", "error", "mse", "mae", "rmse", "mape", "perplexity", "ce", "nll", "kl"}

func isHigherBetter(name string) bool {
	name = strings.ToLower(name)
	for _, s := range lowerBetterNames {
		if strings.Contains(name, s) {
			return false
		}
	}
	for _, s := range higherBetterNames {
		if strings.Contains(name, s) {
			return true
		}
	}
	// Unknown metric; assume lower is better (loss is common default).
	return false
}

// primaryMetric picks the most informative final metric name from a set of keys.
// Priority: val_acc > val_loss > acc > loss > others.
func primaryMetric(keys []string) string {
	priority := []string{"val_acc", "val_accuracy", "val_loss", "acc", "accuracy", "loss"}
	for _, p := range priority {
		for _, k := range keys {
			if strings.ToLower(k) == p {
				return k
			}
		}
	}
	if len(keys) > 0 {
		return keys[0]
	}
	return ""
}

func computeMetricsDiff(runs []domain.Run) MetricsDiff {
	keySet := map[string]struct{}{}
	for _, r := range runs {
		for k := range r.Final {
			keySet[k] = struct{}{}
		}
	}
	keys := make([]string, 0, len(keySet))
	for k := range keySet {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	rows := make([]MetricSummaryRow, 0, len(keys))
	for _, k := range keys {
		hb := isHigherBetter(k)
		vals := make([]float64, len(runs))
		for i, r := range runs {
			if v, ok := r.Final[k]; ok {
				vals[i] = v
			} else {
				vals[i] = math.NaN()
			}
		}

		bestIdx := -1
		bestVal := math.NaN()
		for i, v := range vals {
			if math.IsNaN(v) {
				continue
			}
			if math.IsNaN(bestVal) {
				bestVal = v
				bestIdx = i
				continue
			}
			if hb && v > bestVal {
				bestVal = v
				bestIdx = i
			} else if !hb && v < bestVal {
				bestVal = v
				bestIdx = i
			}
		}

		row := MetricSummaryRow{
			Name:         k,
			Values:       vals,
			BestIdx:      bestIdx,
			Delta:        math.NaN(),
			DeltaPct:     math.NaN(),
			HigherBetter: hb,
		}
		if len(runs) == 2 && !math.IsNaN(vals[0]) && !math.IsNaN(vals[1]) {
			row.Delta = vals[1] - vals[0]
			if vals[0] != 0 {
				row.DeltaPct = row.Delta / math.Abs(vals[0]) * 100
			}
		}
		rows = append(rows, row)
	}

	winner := ""
	if len(runs) == 2 && len(keys) > 0 {
		prime := primaryMetric(keys)
		var primeRow *MetricSummaryRow
		for i := range rows {
			if rows[i].Name == prime {
				primeRow = &rows[i]
				break
			}
		}
		if primeRow != nil && primeRow.BestIdx >= 0 {
			switch primeRow.BestIdx {
			case 0:
				winner = "A"
			case 1:
				winner = "B"
			}
		} else if primeRow != nil {
			winner = "tie"
		}
	}

	return MetricsDiff{Winner: winner, Rows: rows}
}

// ── Env / Hardware ───────────────────────────────────────────────────────────

func computeStringMapDiff(maps []map[string]any) (changed map[string][]string, same map[string]string) {
	changed = map[string][]string{}
	same = map[string]string{}

	keySet := map[string]struct{}{}
	for _, m := range maps {
		for k := range m {
			keySet[k] = struct{}{}
		}
	}
	for k := range keySet {
		vals := make([]string, len(maps))
		for i, m := range maps {
			if v, ok := m[k]; ok {
				vals[i] = fmt.Sprintf("%v", v)
			} else {
				vals[i] = ""
			}
		}
		ref := vals[0]
		allSame := true
		for _, v := range vals[1:] {
			if v != ref {
				allSame = false
				break
			}
		}
		if allSame {
			same[k] = ref
		} else {
			changed[k] = vals
		}
	}
	return
}

func computeEnvDiff(runs []domain.Run) EnvDiff {
	maps := make([]map[string]any, len(runs))
	for i, r := range runs {
		maps[i] = r.Env
	}
	c, s := computeStringMapDiff(maps)
	return EnvDiff{Changed: c, Same: s}
}

func computeHWDiff(runs []domain.Run) HardwareDiff {
	maps := make([]map[string]any, len(runs))
	for i, r := range runs {
		maps[i] = r.Hardware
	}
	c, s := computeStringMapDiff(maps)
	return HardwareDiff{Changed: c, Same: s}
}

// ── Data ─────────────────────────────────────────────────────────────────────

func computeDataDiff(runs []domain.Run) DataDiff {
	d := DataDiff{
		Values: make([]string, len(runs)),
		Hashes: make([]string, len(runs)),
	}
	for i, r := range runs {
		d.Values[i] = r.Dataset
		d.Hashes[i] = r.DatasetHash
	}
	d.Same = allEqual(d.Values)
	d.SameHash = allEqual(d.Hashes)
	return d
}

func allEqual(ss []string) bool {
	if len(ss) == 0 {
		return true
	}
	ref := ss[0]
	for _, s := range ss[1:] {
		if s != ref {
			return false
		}
	}
	return true
}

// ── Insight ──────────────────────────────────────────────────────────────────

// candidate is an explanation candidate with a confidence score.
type candidate struct {
	label      string
	confidence float64
}

func computeInsight(runs []domain.Run, r DiffReport) Insight {
	if len(runs) < 2 {
		return Insight{}
	}
	a, b := runs[0], runs[1]

	var candidates []candidate

	// 1. Different dataset hash → very high confidence.
	if !r.Data.SameHash && (r.Data.Hashes[0] != "" || r.Data.Hashes[1] != "") {
		candidates = append(candidates, candidate{
			label:      fmt.Sprintf("different dataset hash (%s → %s)", shortHash(r.Data.Hashes[0]), shortHash(r.Data.Hashes[1])),
			confidence: 0.95,
		})
	}
	if !r.Data.Same && (r.Data.Values[0] != "" || r.Data.Values[1] != "") {
		candidates = append(candidates, candidate{
			label:      fmt.Sprintf("different dataset (%q → %q)", r.Data.Values[0], r.Data.Values[1]),
			confidence: 0.90,
		})
	}

	// 2. Different optimizer → high.
	for _, key := range []string{"optimizer", "opt", "optim", "optimiser"} {
		va := hparamStr(a, key)
		vb := hparamStr(b, key)
		if va != "" && vb != "" && !strings.EqualFold(va, vb) {
			candidates = append(candidates, candidate{
				label:      fmt.Sprintf("optimizer changed %s→%s", va, vb),
				confidence: 0.85,
			})
			break
		}
	}

	// 3. Learning rate differs by ≥10× → high.
	for _, key := range []string{"lr", "learning_rate", "learning-rate", "init_lr"} {
		va := hparamFloat(a, key)
		vb := hparamFloat(b, key)
		if !math.IsNaN(va) && !math.IsNaN(vb) && va > 0 && vb > 0 {
			ratio := va / vb
			if ratio > 10 || ratio < 0.1 {
				candidates = append(candidates, candidate{
					label:      fmt.Sprintf("learning rate %.2e → %.2e (%.0f×)", va, vb, math.Max(ratio, 1/ratio)),
					confidence: 0.82,
				})
			}
			break
		}
	}

	// 4. Different scheduler → medium-high.
	for _, key := range []string{"scheduler", "lr_scheduler", "schedule"} {
		va := hparamStr(a, key)
		vb := hparamStr(b, key)
		if va != "" && vb != "" && !strings.EqualFold(va, vb) {
			candidates = append(candidates, candidate{
				label:      fmt.Sprintf("scheduler changed %s→%s", va, vb),
				confidence: 0.72,
			})
			break
		}
	}

	// 5. Different model architecture → high.
	for _, key := range []string{"model", "arch", "architecture", "backbone", "encoder"} {
		va := hparamStr(a, key)
		vb := hparamStr(b, key)
		if va != "" && vb != "" && !strings.EqualFold(va, vb) {
			candidates = append(candidates, candidate{
				label:      fmt.Sprintf("model changed %s→%s", va, vb),
				confidence: 0.80,
			})
			break
		}
	}

	// 6. Different seed only (seed changed, nothing else relevant changed) → low.
	seedDiffers := false
	for _, key := range []string{"seed", "random_seed", "rand_seed"} {
		va := hparamStr(a, key)
		vb := hparamStr(b, key)
		if va != "" && vb != "" && va != vb {
			seedDiffers = true
			break
		}
	}
	if seedDiffers && len(candidates) == 0 {
		candidates = append(candidates, candidate{
			label:      "seed changed (may be variance, not a causal factor)",
			confidence: 0.20,
		})
	}

	// 7. Different hardware → low (for accuracy), possibly high for speed.
	if len(r.Hardware.Changed) > 0 {
		hwKeys := sortedKeys(r.Hardware.Changed)
		candidates = append(candidates, candidate{
			label:      fmt.Sprintf("hardware differs (%s)", strings.Join(hwKeys, ", ")),
			confidence: 0.25,
		})
	}

	// Sort candidates by confidence descending.
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].confidence > candidates[j].confidence
	})

	labels := make([]string, len(candidates))
	topConf := 0.0
	for i, c := range candidates {
		labels[i] = c.label
		if i == 0 {
			topConf = c.confidence
		}
	}
	// Diminish confidence if many candidates (more explanations = more uncertainty).
	if len(candidates) > 1 {
		topConf *= 0.85
	}

	// Winner and delta from MetricsDiff.
	winner := r.Metrics.Winner
	deltaMetric := ""
	deltaValue := math.NaN()
	deltaPct := math.NaN()
	prime := ""
	if len(r.Metrics.Rows) > 0 {
		metricNames := make([]string, len(r.Metrics.Rows))
		for i, row := range r.Metrics.Rows {
			metricNames[i] = row.Name
		}
		prime = primaryMetric(metricNames)
		for _, row := range r.Metrics.Rows {
			if row.Name == prime {
				deltaMetric = row.Name
				if len(r.Metrics.Rows) > 0 {
					deltaValue = row.Delta
					deltaPct = row.DeltaPct
				}
				break
			}
		}
	}

	return Insight{
		Winner:      winner,
		DeltaMetric: deltaMetric,
		DeltaValue:  safeFloat(deltaValue),
		DeltaPct:    safeFloat(deltaPct),
		Likely:      labels,
		Confidence:  topConf,
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func hparamStr(r domain.Run, key string) string {
	if v, ok := r.HParams[key]; ok {
		return fmt.Sprintf("%v", v)
	}
	return ""
}

func hparamFloat(r domain.Run, key string) float64 {
	if v, ok := r.HParams[key]; ok {
		switch n := v.(type) {
		case float64:
			return n
		case float32:
			return float64(n)
		case int:
			return float64(n)
		case int64:
			return float64(n)
		}
	}
	return math.NaN()
}

func shortHash(h string) string {
	if len(h) > 8 {
		return h[:8]
	}
	return h
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func safeFloat(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}
