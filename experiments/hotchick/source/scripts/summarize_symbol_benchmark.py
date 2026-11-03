#!/usr/bin/env python3
"""Summarize completed symbol benchmark runs without pooling unlike conditions.

Use --input main.json static.json stagger.json to include explicitly selected runs.
No browser, benchmark runner, network service, or plotting dependency is started.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import math
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


METRICS = {
    "render_fps": ("Render FPS", "fps", 2),
    "raf_fps": ("rAF FPS", "fps", 2),
    "raf_p95_ms": ("rAF p95", "ms", 2),
    "raf_p99_ms": ("rAF p99", "ms", 2),
    "raf_over33_pct": ("rAF >33.3ms", "%", 2),
    "raf_over50_pct": ("rAF >50ms", "%", 2),
    "video_dropped_pct": ("影片掉幀", "%", 3),
    "video_frames": ("影片總幀數增量", "frames", 0),
    "video_dropped_frames": ("影片掉幀增量", "frames", 0),
    "video_players": ("影片播放器", "count", 0),
    "video_non_advancing": ("未前進播放器", "count", 0),
    "cpu_core_equivalents": ("Chrome CPU", "core-equivalents", 3),
    "working_set_mib": ("Chrome 工作集合計", "MiB", 1),
    "working_set_processes": ("工作集進程數", "count", 0),
    "js_heap_start_mib": ("JS heap 起", "MiB", 2),
    "js_heap_end_mib": ("JS heap 迄", "MiB", 2),
    "js_heap_delta_mib": ("JS heap 差", "MiB", 2),
    "wasm_linear_mib": ("WASM linear memory", "MiB", 2),
    "render_submit_p95_ms": ("CPU render submit p95", "ms", 2),
    "render_interval_p95_ms": ("Render interval p95", "ms", 2),
    "gl_texture_count": ("GL textures", "count", 0),
    "draw_calls": ("Draw calls", "count", 0),
    "world_entities": ("World entities", "count", 0),
    "lua_seconds_per_wall_second": ("Luau seconds / wall second", "ratio", 3),
}
PRIMARY = ["render_fps", "raf_p95_ms", "raf_over33_pct", "video_dropped_pct",
           "cpu_core_equivalents", "working_set_mib", "js_heap_end_mib"]
SECONDARY = ["raf_fps", "raf_over50_pct", "video_players", "video_non_advancing",
             "wasm_linear_mib", "gl_texture_count", "world_entities", "lua_seconds_per_wall_second"]
COLORS = {"static": "#8a98ab", "webm-shared": "#30c8d5", "webm-independent": "#ffad60", "atlas": "#b798ff"}


def number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def path_value(mapping, *keys):
    for key in keys:
        if not isinstance(mapping, dict):
            return None
        mapping = mapping.get(key)
    return mapping


def unique(values):
    return list(dict.fromkeys(value for value in values if value is not None and value != ""))


def mib(value):
    value = number(value)
    return value / 2**20 if value is not None else None


def media_decoders(players):
    """Read actual CDP Media properties; GPU feature status is never evidence here."""
    found = []
    if isinstance(players, dict):
        entries = players.values()
    elif isinstance(players, list):
        entries = players
    else:
        entries = []
    for player in entries:
        if not isinstance(player, dict):
            continue
        properties = dict(player)
        props = player.get("properties")
        if isinstance(props, dict):
            properties.update(props)
        elif isinstance(props, list):
            properties.update({p["name"]: p.get("value") for p in props if isinstance(p, dict) and "name" in p})
        decoder = properties.get("kVideoDecoderName") or properties.get("videoDecoderName") or properties.get("decoderName")
        if decoder:
            found.append({"name": str(decoder), "is_platform_decoder": properties.get("kIsPlatformVideoDecoder")})
    return found


def working_set(cases):
    if isinstance(cases, list):
        values = [number(p.get("rss_bytes")) for p in cases if isinstance(p, dict)]
        values = [v for v in values if v is not None]
        return (sum(values) / 2**20, len(values)) if values else (None, None)
    if isinstance(cases, dict):
        total = cases.get("totalRssBytes", cases.get("total_bytes"))
        return mib(total), number(cases.get("processCount"))
    return None, None


def normalize(case, run, source, source_index):
    md, m = case.get("metadata") or {}, case.get("measurement") or {}
    vids = m.get("videos") or {}
    metrics = {key: None for key in METRICS}
    metrics.update({
        "render_fps": number(m.get("renderFps")), "raf_fps": number(m.get("rafFps")),
        "raf_p95_ms": number(path_value(m, "raf", "p95")),
        "raf_p99_ms": number(path_value(m, "raf", "p99")),
        "video_dropped_pct": (number(vids.get("droppedRatio")) * 100 if number(vids.get("droppedRatio")) is not None else None),
        "video_frames": number(vids.get("totalVideoFrames")),
        "video_dropped_frames": number(vids.get("droppedVideoFrames")),
        "video_players": number(vids.get("players")),
        "video_non_advancing": number(vids.get("nonAdvancing")),
        "cpu_core_equivalents": number(case.get("cpuCoreEquivalents")),
        "js_heap_start_mib": mib(m.get("jsHeapStart")), "js_heap_end_mib": mib(m.get("jsHeapEnd")),
        "wasm_linear_mib": mib(m.get("wasmLinearBytes")),
        "render_submit_p95_ms": number(path_value(m, "renderCpuSubmitMs", "p95")),
        "render_interval_p95_ms": number(path_value(m, "renderIntervals", "p95")),
        "gl_texture_count": number(path_value(m, "rendererMetrics", "textures")),
        "draw_calls": number(path_value(m, "rendererMetrics", "draw_calls")),
        "world_entities": number(m.get("worldEntityCount", md.get("worldEntityCount"))),
        "lua_seconds_per_wall_second": number(m.get("luaSecondsPerWallSecond")),
    })
    metrics["working_set_mib"], metrics["working_set_processes"] = working_set(case.get("chromeProcessWorkingSets"))
    if metrics["js_heap_start_mib"] is not None and metrics["js_heap_end_mib"] is not None:
        metrics["js_heap_delta_mib"] = metrics["js_heap_end_mib"] - metrics["js_heap_start_mib"]
    if metrics["gl_texture_count"] is None:
        metrics["gl_texture_count"] = number(path_value(m, "officialEnd", "textures"))
    intervals = [number(v) for v in m.get("rafIntervalsMs", [])]
    intervals = [v for v in intervals if v is not None]
    for field, threshold, fallback in [("raf_over33_pct", 33.3, "rafOver33_3"), ("raf_over50_pct", 50, "rafOver50")]:
        metrics[field] = (sum(v > threshold for v in intervals) / len(intervals) * 100 if intervals
                          else number(m.get(fallback)) * 100 if number(m.get(fallback)) is not None else None)
    settings = run.get("settings") or {}
    conditions = {
        "gpu": md.get("gpu"), "viewport": md.get("viewport"), "drawing_buffer": md.get("drawingBuffer"),
        "device_pixel_ratio": md.get("devicePixelRatio"), "browser": path_value(run, "browser", "Browser"),
        "browser_mode": settings.get("browserMode"), "cpu": path_value(run, "machine", "cpu"),
        "logical_cores": path_value(run, "machine", "logicalCores"),
        "renderer_implementation": md.get("rendererImplementation"), "factory_mode": md.get("selectedRendererMode"),
        "sdk": md.get("sdk"), "runtime_id": md.get("runtimeId"),
        "game_source": md.get("gameSource"), "presentation_source": md.get("presentationSource"),
        "matched_assets": md.get("matchedAssetSpecs"),
        "canonical_rgba_sha256": path_value(md, "mediaManifest", "canonical", "rgba_sequence_sha256"),
        "configured_warmup_ms": settings.get("warmupMs"), "configured_measurement_ms": settings.get("durationMs"),
    }
    condition_id = hashlib.sha256(json.dumps(conditions, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:10]
    alerts = []
    for where in ["visibilityStart", "visibilityEnd"]:
        if m.get(where) != "visible":
            alerts.append(f"{where}={m.get(where)!r}")
    if m.get("visibilityEvents"):
        alerts.append("measurement contains visibility changes")
    if number(vids.get("nonAdvancing")) and vids["nonAdvancing"] > 0:
        alerts.append(f"{vids['nonAdvancing']} video players did not advance")
    if case.get("consoleErrors"):
        alerts.append(f"consoleErrors={len(case['consoleErrors'])}")
    decoders = media_decoders(case.get("mediaPlayers"))
    row = {"source": source, "source_case_index": source_index, "repeat": case.get("repeat"),
           "mode": case.get("mode", md.get("mode", "unknown")), "count": case.get("count", md.get("count")),
           "phase": case.get("phase", md.get("phase", "unknown")), "status": case.get("status", "unknown"),
           "condition_id": condition_id, "conditions": conditions, "metrics": metrics,
           "included_in_statistics": case.get("status") in ("ok", "success", "completed") and bool(m),
           "duration_ms": number(m.get("durationMs")), "raf_samples": number(path_value(m, "raf", "samples")),
           "render_frame_count": number(m.get("renderFrameCount")),
           "actual_video_players": md.get("actualVideoPlayers"), "media_decoders": decoders,
           "visibility_start": m.get("visibilityStart"), "visibility_end": m.get("visibilityEnd"),
           "alerts": alerts, "error": case.get("error"),
           "video_per_player": vids.get("perPlayer"),
           "official_start": m.get("officialStart"), "official_end": m.get("officialEnd"),
           "renderer_metrics": m.get("rendererMetrics")}
    return row


def aggregate(rows):
    buckets = defaultdict(list)
    for row in rows:
        buckets[(row["mode"], row["count"], row["phase"], row["condition_id"])].append(row)
    result = []
    for (mode, count, phase, cid), cases in sorted(buckets.items(), key=lambda kv: (str(kv[0][2]), str(kv[0][0]), kv[0][1] or 0, kv[0][3])):
        accepted = [r for r in cases if r["included_in_statistics"]]
        stats = {}
        for metric in METRICS:
            values = [r["metrics"][metric] for r in accepted if r["metrics"][metric] is not None]
            stats[metric] = {"n": len(values), "median": statistics.median(values) if values else None,
                             "min": min(values) if values else None, "max": max(values) if values else None,
                             "values": values}
        result.append({"mode": mode, "count": count, "phase": phase, "condition_id": cid,
                       "conditions": cases[0]["conditions"], "total_cases": len(cases),
                       "accepted_cases": len(accepted), "excluded_cases": len(cases) - len(accepted),
                       "statuses": dict(Counter(r["status"] for r in cases)),
                       "sources": unique(r["source"] for r in cases), "metrics": stats,
                       "alerts": unique(a for r in cases for a in r["alerts"])})
    return result


def display(value, metric):
    if value is None:
        return "—"
    return f"{value:.{METRICS[metric][2]}f}"


def stat_cell(group, metric):
    stat = group["metrics"][metric]
    if not stat["n"]:
        return "—"
    return f"{display(stat['median'], metric)} [{display(stat['min'], metric)}–{display(stat['max'], metric)}]"


def metric_header(metric):
    label, unit, _ = METRICS[metric]
    return f"{label} ({unit})"


def html_table(headers, rows):
    return '<div class="table-wrap"><table><thead><tr>' + ''.join(f"<th>{html.escape(str(h))}</th>" for h in headers) + '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(f"<td>{html.escape(str(c))}</td>" for c in row) + '</tr>' for row in rows) + '</tbody></table></div>'


def group_table_rows(groups, metrics):
    return [[g["mode"], g["count"], g["phase"], g["condition_id"], f"{g['accepted_cases']}/{g['total_cases']}"] + [stat_cell(g, key) for key in metrics] for g in groups]


def markdown_table(headers, rows):
    def clean(value):
        return str(value).replace("|", "\\|").replace("\n", " ")
    return "| " + " | ".join(map(clean, headers)) + " |\n| " + " | ".join("---" for _ in headers) + " |\n" + ''.join("| " + " | ".join(map(clean, row)) + " |\n" for row in rows)


def chart_svg(groups, phase, metric):
    available = [g for g in groups if g["phase"] == phase and g["metrics"][metric]["n"]]
    if not available:
        return f'<p>{html.escape(str(phase))}: {html.escape(metric_header(metric))} 無有效資料。</p>'
    width, height, left, right, top, bottom = 620, 290, 58, 20, 34, 60
    counts = sorted({g["count"] for g in available})
    ymax = max(g["metrics"][metric]["max"] for g in available)
    ymax = ymax * 1.1 if ymax > 0 else 1
    x = lambda n: left + (counts.index(n) / max(1, len(counts) - 1)) * (width - left - right)
    y = lambda v: height - bottom - v / ymax * (height - top - bottom)
    out = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{html.escape(metric_header(metric))}">',
           f'<text x="{left}" y="20" class="chart-title">{html.escape(metric_header(metric))} · {html.escape(str(phase))}</text>']
    for step in range(5):
        val = ymax * step / 4
        out += [f'<line x1="{left}" y1="{y(val):.2f}" x2="{width-right}" y2="{y(val):.2f}" class="grid"/>',
                f'<text x="{left-7}" y="{y(val)+4:.2f}" text-anchor="end">{val:.1f}</text>']
    for count in counts:
        out.append(f'<text x="{x(count):.2f}" y="{height-bottom+20}" text-anchor="middle">{count}</text>')
    out.append(f'<text x="{width-right}" y="{height-bottom+39}" text-anchor="end">symbol 數量（離散測點）</text>')
    series = defaultdict(list)
    for g in available:
        series[(g["mode"], g["condition_id"])].append(g)
    for index, ((mode, cid), points) in enumerate(sorted(series.items())):
        color = COLORS.get(mode, "#e6d06e")
        points.sort(key=lambda g: g["count"])
        path = ' '.join(f"{x(g['count']):.2f},{y(g['metrics'][metric]['median']):.2f}" for g in points)
        out.append(f'<polyline points="{path}" fill="none" stroke="{color}" stroke-width="2"/>')
        for g in points:
            stat = g["metrics"][metric]
            px = x(g["count"])
            title = html.escape(f"{mode}, count={g['count']}, condition={cid}: {stat_cell(g, metric)}, n={stat['n']}")
            out.append(f'<g><title>{title}</title><line x1="{px:.2f}" x2="{px:.2f}" y1="{y(stat["min"]):.2f}" y2="{y(stat["max"]):.2f}" stroke="{color}" stroke-width="2"/><circle cx="{px:.2f}" cy="{y(stat["median"]):.2f}" r="4" fill="{color}"/></g>')
    out.append('</svg>')
    legends = ' '.join(f'<span class="legend"><i style="background:{COLORS.get(mode,"#e6d06e")}"></i>{html.escape(mode)} / {cid}</span>' for mode, cid in sorted(series))
    return '<div class="chart">' + ''.join(out) + '<div>' + legends + '</div></div>'


def methods(summary):
    conditions = summary["conditions"]
    gpu_names = unique(path_value(c, "gpu", "renderer") for c in conditions.values())
    visibility = unique(r["visibility_start"] for r in summary["cases"]) + unique(r["visibility_end"] for r in summary["cases"])
    specs = unique(json.dumps(c.get("matched_assets"), ensure_ascii=False, sort_keys=True) for c in conditions.values())
    decoder_counts = Counter((d["name"], str(d["is_platform_decoder"])) for r in summary["cases"] for d in r["media_decoders"])
    decoder_text = '; '.join(f"{name} (kIsPlatformVideoDecoder={platform}, {n} player observations)" for (name, platform), n in sorted(decoder_counts.items())) or "未取得 decoder property，不能判定實際解碼器"
    if decoder_counts and all(name == "VpxVideoDecoder" and platform.lower() == "false" for name, platform in decoder_counts):
        decoder_text += "；這些已觀察到的透明 VP9 player properties 顯示 VpxVideoDecoder 軟體解碼"
    return [
        "本輪匹配素材為 144×256 RGBA、12fps、60 格、5.000 秒；WebM 為 VP9 alpha CRF30，atlas 為兩頁 lossless WebP。原始 430×768、24fps 影片未做本輪同播測試。實測 metadata: " + '; '.join(specs),
        "此測試將同一片舞蹈放成多個 symbol。webm-shared 共用一個影片時間軸；webm-independent 使用多個影片播放實例，但來源仍是同一檔案；atlas 共用圖集。這不是多種不同女孩素材同時出現的測試。sync 與 stagger 各自分組。",
        "GPU 實測 renderer: " + ('; '.join(gpu_names) if gpu_names else "未取得，不能宣稱使用特定 GPU"),
        "瀏覽器以 headless Chrome 執行；頁面 visibility 實測值: " + ', '.join(str(v) for v in unique(visibility)) + "。visibility=visible 不代表一般使用者的前景視窗基準；結果只適用於這次設備、版本、場景及測試設定。",
        "實際 decoder 僅採 CDP Media player properties: " + decoder_text + "。GPU feature video_decode=enabled 不能單獨證明本片使用硬體解碼。",
        "場景走 SDK 正式 createThreeRenderer 與 Luau world；export factory 的 selectedRendererMode=custom 是接入 presentation 的入口，presentation 委派 official renderer。實際 SDK、runtime 與原始碼位置列於條件表。",
        "Render FPS 來自正式 renderer 的 frame hook；rAF p95 與 >33.3ms 比例描述瀏覽器回呼間隔。CPU render submit 時間不等於 GPU 執行時間。每次先算指標，再對同 mode/count/phase/condition 的重複測試取 median/min/max，沒有合併不同測次的 frame samples 重新算 p95。",
        "Chrome CPU core-equivalents 為進程 CPU 時間增量除以量測牆鐘秒數；1.0 表示約一個 logical core 的時間，並非整台 CPU 的 100%。",
        "工作集為 Chrome 相關進程 RSS／working-set 合計，可能重複計入共享頁；同一 browser 切換頁面也可能保留 GPU 資源與 cache，適合作診斷，不是資產唯一實體 RAM 需求，也不是 GPU memory。JS heap 與 WASM linear memory 分欄呈現，不能視為與 RSS 完全互斥後相加。GL textures 是物件數量，沒有換算為實測 GPU bytes。",
        "本場景只有 Luau 盤面移動與透明媒體，沒有正式捕魚射擊彈道、大獎特效或網路業務負載；即使 128 顆測得約 60 Render FPS，也不代表正式遊戲可直接把效能預算用滿。",
        "空值顯示 —，不當作零。失敗 case 保留於逐次紀錄但排除數值統計。n=1 的 min/median/max 相同不代表沒有波動；此報告沒有推導所有桌機皆可放置某個固定數量。",
    ]


def observations(summary):
    lines = []
    selected = [g for g in summary['groups'] if g['count'] == 128]
    for phase in unique(g['phase'] for g in selected):
        phase_groups = [g for g in selected if g['phase'] == phase]
        independent = [g for g in phase_groups if g['mode'] == 'webm-independent']
        atlases = [g for g in phase_groups if g['mode'] == 'atlas']
        for group in independent:
            lines.append(f"128 顆獨立 WebM、{phase}：Render FPS {stat_cell(group, 'render_fps')}；影片掉幀 {stat_cell(group, 'video_dropped_pct')}%；Chrome CPU {stat_cell(group, 'cpu_core_equivalents')} core-equivalents。盤面仍接近 60 FPS 時，影片內容仍可能掉幀；sync 與 stagger 為不同實測條件。")
            compatible = [g for g in atlases if g['condition_id'] == group['condition_id']]
            if len(compatible) == 1:
                baseline = compatible[0]['metrics']['cpu_core_equivalents']['median']
                numerator = group['metrics']['cpu_core_equivalents']['median']
                if baseline and numerator is not None:
                    lines.append(f"128 顆、{phase}：獨立 WebM 的 CPU 中位數約為 atlas 的 {numerator / baseline:.2f} 倍（同條件比較）。")
    return lines


def write_outputs(summary, output, *, html_only=False):
    output.mkdir(parents=True, exist_ok=True)
    if not html_only:
        (output / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        csv_fields = ["record_type", "stat", "mode", "count", "phase", "condition_id", "repeat", "status", "source"] + list(METRICS)
        with (output / "summary.csv").open('w', encoding='utf-8-sig', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=csv_fields)
            writer.writeheader()
            for row in summary["cases"]:
                writer.writerow({"record_type": "case", **{k: row[k] for k in ["mode", "count", "phase", "condition_id", "repeat", "status", "source"]}, **row["metrics"]})
            for group in summary["groups"]:
                for stat in ["median", "min", "max"]:
                    writer.writerow({"record_type": "group", "stat": stat,
                                     **{k: group[k] for k in ["mode", "count", "phase", "condition_id"]},
                                     **{key: group["metrics"][key][stat] for key in METRICS}})
    group_headers = ["Mode", "數量", "Phase", "Condition", "成功/總次"]
    primary_rows = group_table_rows(summary["groups"], PRIMARY)
    secondary_rows = group_table_rows(summary["groups"], SECONDARY)
    condition_rows = [[cid, c.get("browser"), c.get("cpu"), path_value(c, "gpu", "renderer"),
                       c.get("viewport"), c.get("drawing_buffer"), c.get("device_pixel_ratio"),
                       c.get("configured_warmup_ms"), c.get("configured_measurement_ms"),
                       c.get("sdk"), c.get("runtime_id"), c.get("renderer_implementation"),
                       c.get("factory_mode"), c.get("game_source"), c.get("presentation_source")]
                      for cid, c in summary["conditions"].items()]
    condition_headers = ["Condition", "Browser", "CPU", "GPU renderer", "Viewport", "Buffer", "DPR", "Warmup ms", "Measure ms", "SDK", "Runtime", "Renderer", "Factory", "Luau source", "Presentation source"]
    repeats = [[r["source"], r["repeat"], r["mode"], r["count"], r["phase"], r["condition_id"], r["status"]]
               + [display(r["metrics"][key], key) for key in PRIMARY]
               + ['; '.join(r["alerts"]) or r.get("error") or "—"] for r in summary["cases"]]
    repeat_headers = ["來源", "Repeat", "Mode", "數量", "Phase", "Condition", "Status"] + [metric_header(key) for key in PRIMARY] + ["檢查訊息"]
    method_lines = methods(summary)
    lead = f"本次彙整 {len(summary['cases'])} 個 case，{sum(r['included_in_statistics'] for r in summary['cases'])} 個成功 case，分為 {len(summary['groups'])} 組。表格為 median [min–max]；成功/總次僅表示執行狀態，visibility 等檢查另列。"
    chart_metrics = ["render_fps", "raf_p95_ms", "raf_over33_pct", "video_dropped_pct", "cpu_core_equivalents", "working_set_mib"]
    charts = ''.join(f'<h2>Phase: {html.escape(str(phase))}</h2><div class="charts">' + ''.join(chart_svg(summary["groups"], phase, metric) for metric in chart_metrics) + '</div>' for phase in unique(g["phase"] for g in summary["groups"]))
    body = '<h1>Symbol 透明影片與圖集實測</h1><p>' + html.escape(lead) + '</p>'
    body += '<p class="links"><a href="summary.json">summary.json</a> · <a href="summary.csv">summary.csv</a></p>'
    gpu_labels = unique(path_value(c, 'gpu', 'renderer') for c in summary['conditions'].values())
    short_scope = '範圍：144×256、12fps，同一女孩素材重用；headless Chrome，GPU 實測：' + ('; '.join(gpu_labels) or '未取得') + '。場景無正式彈道、大獎特效與網路業務負載。'
    body += '<p>' + html.escape(short_scope) + '</p>'
    body += '<h2>本次觀察與素材配置建議</h2><ul>' + ''.join('<li>' + html.escape(line) + '</li>' for line in observations(summary)) + '</ul>'
    body += '<p>依這次同素材測試，建議同步待機共用 WebM 播放器與時間軸；需要許多獨立時序的小動畫時優先考慮圖集以降低 CPU；大滿版演出保留 WebM。這是素材配置建議，大滿版與正式遊戲負載仍需另外驗證。</p>'
    body += '<h2>主要結果</h2>' + html_table(group_headers + [metric_header(k) for k in PRIMARY], primary_rows)
    body += '<p>折線為各測點 median，垂直線為重複測試 min–max；不同 phase 與 condition 不合併。橫軸為離散測試數量，連線只用於閱讀趨勢。</p>' + charts
    body += '<h2>播放與引擎檢查</h2>' + html_table(group_headers + [metric_header(k) for k in SECONDARY], secondary_rows)
    body += '<details><summary>測試範圍與指標解讀（完整方法與限制）</summary><ul>' + ''.join('<li>' + html.escape(line) + '</li>' for line in method_lines) + '</ul></details>'
    body += '<h2>實測條件與程式位置</h2>' + html_table(condition_headers, condition_rows)
    body += '<details><summary>查看每一次 case</summary>' + html_table(repeat_headers, repeats) + '</details>'
    body += '<h2>資料來源</h2>' + html_table(["檔案", "SHA-256", "完成時間", "Case 數"], [[s["file"], s["sha256"], s["completed_at"], s["case_count"]] for s in summary["sources"]])
    css = """:root{color-scheme:dark;font:14px/1.6 system-ui,sans-serif}body{margin:0;background:#101722;color:#e7eef8}main{max-width:1600px;margin:auto;padding:28px}h1{font-size:28px}h2{font-size:21px;margin:30px 0 12px}p,li{color:#bfccdf}li{margin:8px 0}a{color:#78dce5}.table-wrap{overflow:auto;border:1px solid #354257;border-radius:10px;margin:12px 0}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #2d3a4d;white-space:nowrap}th{background:#1d2a3d;position:sticky;top:0}tbody tr:nth-child(even){background:#162131}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.chart{background:#162131;padding:14px;border-radius:12px;border:1px solid #354257}.chart svg{display:block;width:100%;height:auto}.chart text{fill:#bfcde1;font-size:11px}.chart .chart-title{font-size:15px;fill:#e7eef8}.grid{stroke:#344257;stroke-width:1}.legend{display:inline-block;margin:4px 12px 0 0;font-size:11px;color:#c1cfe0}.legend i{display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:50%}details{margin:20px 0}summary{cursor:pointer;font-size:18px}@media(max-width:850px){main{padding:16px}.charts{grid-template-columns:1fr}}"""
    document = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Symbol benchmark 實測報告</title><style>' + css + '</style></head><body><main>' + body + '</main></body></html>'
    (output / "report.html").write_text(document, encoding='utf-8')


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', nargs='+', type=Path, default=[root / 'artifacts/symbol-benchmark/results/raw-results.json'])
    parser.add_argument('--output', type=Path, default=root / 'artifacts/symbol-benchmark')
    parser.add_argument('--validate-only', action='store_true', help='Parse and aggregate without writing any output')
    parser.add_argument('--allow-partial', action='store_true', help='Explicitly permit files without completedAt')
    args = parser.parse_args()
    rows, sources = [], []
    input_paths = unique(str(p.resolve()) for p in args.input)
    for input_path in input_paths:
        path = Path(input_path)
        raw = path.read_bytes()
        run = json.loads(raw)
        if not isinstance(run, dict) or not isinstance(run.get('cases'), list):
            raise SystemExit(f'{path}: expected an object with a cases array')
        if not run.get('completedAt') and not args.allow_partial:
            raise SystemExit(f'{path}: completedAt is missing; wait for completion or explicitly use --allow-partial')
        sources.append({'file': str(path), 'sha256': hashlib.sha256(raw).hexdigest(),
                        'completed_at': run.get('completedAt'), 'case_count': len(run['cases']),
                        'settings': run.get('settings'), 'machine': run.get('machine'), 'browser': run.get('browser')})
        for index, case in enumerate(run['cases']):
            rows.append(normalize(case, run, str(path), index))
    if not rows:
        raise SystemExit('No cases found in the explicitly selected inputs')
    groups = aggregate(rows)
    summary = {'schema_version': 1, 'built_at_utc': datetime.now(timezone.utc).isoformat(),
               'grouping': ['mode', 'count', 'phase', 'condition_id'],
               'statistics': 'Per-case metrics, then median/min/max across successful repeats; no pooled frame samples',
               'metric_units': {key: {'label': value[0], 'unit': value[1]} for key, value in METRICS.items()},
               'sources': sources, 'conditions': {r['condition_id']: r['conditions'] for r in rows},
               'groups': groups, 'cases': rows}
    if not args.validate_only:
        write_outputs(summary, args.output)
    print(json.dumps({'validate_only': args.validate_only, 'inputs': len(sources), 'cases': len(rows),
                      'successful': sum(r['included_in_statistics'] for r in rows), 'groups': len(groups),
                      'conditions': len(summary['conditions']),
                      'written': [] if args.validate_only else ['report.html', 'summary.json', 'summary.csv']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
