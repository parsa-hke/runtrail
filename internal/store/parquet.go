package store

import (
	"sort"

	"github.com/parquet-go/parquet-go"
)

// metricsParquetRow mirrors the long-format schema written by the Python SDK:
// step INT64, wall_ms INT64, metric STRING, value DOUBLE.
type metricsParquetRow struct {
	Step   int64   `parquet:"step"`
	WallMS int64   `parquet:"wall_ms"`
	Metric string  `parquet:"metric"`
	Value  float64 `parquet:"value"`
}

// readMetricsParquet pivots the long-format Parquet file written at run end
// back to wide-format MetricRow values. If names is non-empty, only those
// metrics are kept.
func readMetricsParquet(path string, names []string) ([]MetricRow, error) {
	rows, err := parquet.ReadFile[metricsParquetRow](path)
	if err != nil {
		return nil, err
	}

	nameSet := map[string]struct{}{}
	for _, n := range names {
		nameSet[n] = struct{}{}
	}

	// Group by (step, wall_ms). The Python SDK writes one row per (step, metric)
	// so the same (step, wall_ms) appears multiple times within a single log call.
	type key struct {
		step   int64
		wallMS int64
	}
	idx := map[key]int{}
	var out []MetricRow
	for _, r := range rows {
		if len(nameSet) > 0 {
			if _, ok := nameSet[r.Metric]; !ok {
				continue
			}
		}
		k := key{r.Step, r.WallMS}
		i, ok := idx[k]
		if !ok {
			out = append(out, MetricRow{Step: r.Step, WallMS: r.WallMS, Values: map[string]float64{}})
			i = len(out) - 1
			idx[k] = i
		}
		out[i].Values[r.Metric] = r.Value
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Step != out[j].Step {
			return out[i].Step < out[j].Step
		}
		return out[i].WallMS < out[j].WallMS
	})
	return out, nil
}
