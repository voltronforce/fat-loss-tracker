#!/usr/bin/env python3
"""
Summarise a large Apple Health export into small CSV files for diet/fat-loss tracking.

Usage examples:
  python summarise_apple_health.py export.zip --out health_summary
  python summarise_apple_health.py export.xml --out health_summary --since 2024-01-01
  python summarise_apple_health.py export.zip --out health_summary --source "Apple Watch"

Outputs:
  - daily_summary.csv
  - weekly_summary.csv
  - workouts.csv
  - source_summary.csv

Notes:
  Apple Health exports are raw samples. If multiple devices record the same metric
  at the same time, summing raw samples can differ from the Health app's displayed
  total. Use --source to restrict to a source such as "Apple Watch" if needed.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple, Any
import xml.etree.ElementTree as ET

# Apple Health record type constants we care about first.
TYPE_STEP_COUNT = "HKQuantityTypeIdentifierStepCount"
TYPE_ACTIVE_ENERGY = "HKQuantityTypeIdentifierActiveEnergyBurned"
TYPE_EXERCISE_TIME = "HKQuantityTypeIdentifierAppleExerciseTime"
TYPE_DISTANCE_WALK_RUN = "HKQuantityTypeIdentifierDistanceWalkingRunning"
TYPE_BODY_MASS = "HKQuantityTypeIdentifierBodyMass"
TYPE_RESTING_HR = "HKQuantityTypeIdentifierRestingHeartRate"
TYPE_HRV_SDNN = "HKQuantityTypeIdentifierHeartRateVariabilitySDNN"
TYPE_VO2_MAX = "HKQuantityTypeIdentifierVO2Max"
TYPE_SLEEP = "HKCategoryTypeIdentifierSleepAnalysis"

# Metrics accumulated by summing values.
SUM_METRICS = {
    TYPE_STEP_COUNT: "steps",
    TYPE_ACTIVE_ENERGY: "active_energy_kcal",
    TYPE_EXERCISE_TIME: "exercise_minutes",
    TYPE_DISTANCE_WALK_RUN: "walking_running_distance_km",
}

# Metrics accumulated by daily average.
AVG_METRICS = {
    TYPE_BODY_MASS: "body_weight_kg",
    TYPE_RESTING_HR: "resting_hr_bpm",
    TYPE_HRV_SDNN: "hrv_sdnn_ms",
    TYPE_VO2_MAX: "vo2max",
}

DAILY_COLUMNS = [
    "date",
    "steps",
    "active_energy_kcal",
    "exercise_minutes",
    "walking_running_distance_km",
    "workout_count",
    "workout_minutes",
    "workout_energy_kcal",
    "workout_distance_km",
    "sleep_asleep_hours",
    "sleep_in_bed_hours",
    "body_weight_kg",
    "resting_hr_bpm",
    "hrv_sdnn_ms",
    "vo2max",
]


def parse_apple_datetime(value: Optional[str]) -> Optional[datetime]:
    """Parse Apple Health datetime strings like '2025-01-31 06:32:10 +1100'."""
    if not value:
        return None
    # XML sometimes contains fractional seconds; normalise them away.
    # Examples: 2025-01-31 06:32:10 +1100, 2025-01-31 06:32:10.123 +1100
    value = value.strip()
    value = re.sub(r"(\d{2}:\d{2}:\d{2})\.\d+", r"\1", value)
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        # Some exports may have no timezone. Treat as naive local time.
        try:
            return datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None


def to_float(value: Optional[str]) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def convert_energy_to_kcal(value: float, unit: Optional[str]) -> float:
    unit = (unit or "").lower()
    if unit in {"kj", "kilojoule", "kilojoules"}:
        return value / 4.184
    # Apple usually exports active energy in kcal.
    return value


def convert_distance_to_km(value: float, unit: Optional[str]) -> float:
    unit = (unit or "").lower()
    if unit in {"m", "meter", "meters", "metre", "metres"}:
        return value / 1000.0
    if unit in {"mi", "mile", "miles"}:
        return value * 1.609344
    # Apple usually exports walking/running distance in km.
    return value


def convert_weight_to_kg(value: float, unit: Optional[str]) -> float:
    unit = (unit or "").lower()
    if unit in {"lb", "lbs", "pound", "pounds"}:
        return value * 0.45359237
    return value


def convert_duration_to_minutes(value: float, unit: Optional[str]) -> float:
    unit = (unit or "").lower()
    if unit in {"s", "sec", "second", "seconds"}:
        return value / 60.0
    if unit in {"h", "hr", "hour", "hours"}:
        return value * 60.0
    # Apple usually exports workout duration / exercise time in min.
    return value


def clean_workout_type(value: Optional[str]) -> str:
    if not value:
        return "Unknown"
    return value.replace("HKWorkoutActivityType", "")


def metric_value(record_type: str, value: float, unit: Optional[str]) -> float:
    if record_type == TYPE_ACTIVE_ENERGY:
        return convert_energy_to_kcal(value, unit)
    if record_type == TYPE_DISTANCE_WALK_RUN:
        return convert_distance_to_km(value, unit)
    if record_type == TYPE_EXERCISE_TIME:
        return convert_duration_to_minutes(value, unit)
    if record_type == TYPE_BODY_MASS:
        return convert_weight_to_kg(value, unit)
    return value


def ensure_day(daily: Dict[str, Dict[str, float]], day: str) -> Dict[str, float]:
    d = daily[day]
    for col in DAILY_COLUMNS:
        if col != "date":
            d.setdefault(col, 0.0)
    return d


def add_average(avg_sums: Dict[Tuple[str, str], Tuple[float, int]], day: str, metric: str, value: float) -> None:
    key = (day, metric)
    current_sum, current_count = avg_sums.get(key, (0.0, 0))
    avg_sums[key] = (current_sum + value, current_count + 1)


def split_interval_hours_by_day(start: datetime, end: datetime) -> Iterable[Tuple[str, float]]:
    """Yield (YYYY-MM-DD, hours) for an interval, split at local midnights."""
    if end <= start:
        return
    current = start
    while current < end:
        next_midnight = datetime.combine(
            current.date() + timedelta(days=1),
            time.min,
            tzinfo=current.tzinfo,
        )
        segment_end = min(end, next_midnight)
        hours = (segment_end - current).total_seconds() / 3600.0
        yield current.date().isoformat(), hours
        current = segment_end


def open_export_xml(path: Path):
    """Return a file-like object for export.xml, accepting either export.xml or export.zip."""
    if path.suffix.lower() == ".zip":
        zf = zipfile.ZipFile(path)
        # Typical path is apple_health_export/export.xml.
        matches = [name for name in zf.namelist() if name.endswith("export.xml")]
        if not matches:
            raise FileNotFoundError("Could not find export.xml inside the zip file.")
        # Prefer the shortest matching path if multiple exist.
        export_name = sorted(matches, key=len)[0]
        return zf.open(export_name, "r")
    return open(path, "rb")


def parse_export(
    input_path: Path,
    out_dir: Path,
    since: Optional[date] = None,
    until: Optional[date] = None,
    source_contains: Optional[str] = None,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    source_filter = source_contains.lower() if source_contains else None

    daily: Dict[str, Dict[str, float]] = defaultdict(dict)
    avg_sums: Dict[Tuple[str, str], Tuple[float, int]] = {}
    workouts = []
    source_summary: Dict[Tuple[str, str], Dict[str, float]] = defaultdict(lambda: {"records": 0, "value_sum": 0.0})

    record_count = 0
    workout_count = 0

    with open_export_xml(input_path) as fh:
        context = ET.iterparse(fh, events=("end",))
        for event, elem in context:
            tag = elem.tag.split("}")[-1]  # tolerate namespaces, just in case

            if tag == "Record":
                record_count += 1
                attrs = elem.attrib
                record_type = attrs.get("type", "")
                source_name = attrs.get("sourceName", "Unknown")

                if source_filter and source_filter not in source_name.lower():
                    elem.clear()
                    continue

                start_dt = parse_apple_datetime(attrs.get("startDate"))
                end_dt = parse_apple_datetime(attrs.get("endDate"))
                if not start_dt:
                    elem.clear()
                    continue
                day = start_dt.date().isoformat()

                if since and start_dt.date() < since:
                    elem.clear()
                    continue
                if until and start_dt.date() > until:
                    elem.clear()
                    continue

                value = to_float(attrs.get("value"))
                unit = attrs.get("unit")

                # Source summary, useful for spotting whether steps come from Watch, iPhone, etc.
                if value is not None:
                    ss = source_summary[(record_type, source_name)]
                    ss["records"] += 1
                    ss["value_sum"] += value
                else:
                    source_summary[(record_type, source_name)]["records"] += 1

                if record_type in SUM_METRICS and value is not None:
                    metric = SUM_METRICS[record_type]
                    d = ensure_day(daily, day)
                    d[metric] += metric_value(record_type, value, unit)

                elif record_type in AVG_METRICS and value is not None:
                    metric = AVG_METRICS[record_type]
                    add_average(avg_sums, day, metric, metric_value(record_type, value, unit))
                    ensure_day(daily, day)

                elif record_type == TYPE_SLEEP and end_dt:
                    sleep_value = attrs.get("value", "")
                    if "Asleep" in sleep_value or sleep_value.endswith("Asleep"):
                        for sleep_day, hours in split_interval_hours_by_day(start_dt, end_dt):
                            if since and date.fromisoformat(sleep_day) < since:
                                continue
                            if until and date.fromisoformat(sleep_day) > until:
                                continue
                            ensure_day(daily, sleep_day)["sleep_asleep_hours"] += hours
                    elif "InBed" in sleep_value:
                        for sleep_day, hours in split_interval_hours_by_day(start_dt, end_dt):
                            if since and date.fromisoformat(sleep_day) < since:
                                continue
                            if until and date.fromisoformat(sleep_day) > until:
                                continue
                            ensure_day(daily, sleep_day)["sleep_in_bed_hours"] += hours

                elem.clear()

            elif tag == "Workout":
                workout_count += 1
                attrs = elem.attrib
                source_name = attrs.get("sourceName", "Unknown")

                if source_filter and source_filter not in source_name.lower():
                    elem.clear()
                    continue

                start_dt = parse_apple_datetime(attrs.get("startDate"))
                end_dt = parse_apple_datetime(attrs.get("endDate"))
                if not start_dt:
                    elem.clear()
                    continue
                day = start_dt.date().isoformat()

                if since and start_dt.date() < since:
                    elem.clear()
                    continue
                if until and start_dt.date() > until:
                    elem.clear()
                    continue

                duration = to_float(attrs.get("duration")) or 0.0
                duration_unit = attrs.get("durationUnit") or "min"
                duration_min = convert_duration_to_minutes(duration, duration_unit)

                energy = to_float(attrs.get("totalEnergyBurned")) or 0.0
                energy_kcal = convert_energy_to_kcal(energy, attrs.get("totalEnergyBurnedUnit"))

                distance = to_float(attrs.get("totalDistance")) or 0.0
                distance_km = convert_distance_to_km(distance, attrs.get("totalDistanceUnit"))

                workout_type = clean_workout_type(attrs.get("workoutActivityType"))

                workouts.append(
                    {
                        "date": day,
                        "start": attrs.get("startDate", ""),
                        "end": attrs.get("endDate", ""),
                        "type": workout_type,
                        "duration_minutes": round(duration_min, 1),
                        "energy_kcal": round(energy_kcal, 1),
                        "distance_km": round(distance_km, 2),
                        "source": source_name,
                    }
                )

                d = ensure_day(daily, day)
                d["workout_count"] += 1
                d["workout_minutes"] += duration_min
                d["workout_energy_kcal"] += energy_kcal
                d["workout_distance_km"] += distance_km

                elem.clear()

            else:
                elem.clear()

            if (record_count + workout_count) % 500000 == 0:
                print(f"Parsed {record_count:,} records and {workout_count:,} workouts...", file=sys.stderr)

    # Apply daily averages.
    for (day, metric), (value_sum, count) in avg_sums.items():
        if count:
            ensure_day(daily, day)[metric] = value_sum / count

    write_daily_csv(out_dir / "daily_summary.csv", daily)
    write_weekly_csv(out_dir / "weekly_summary.csv", daily)
    write_workouts_csv(out_dir / "workouts.csv", workouts)
    write_source_summary_csv(out_dir / "source_summary.csv", source_summary)

    print("Done.")
    print(f"Output folder: {out_dir.resolve()}")
    print(f"Records seen: {record_count:,}")
    print(f"Workouts seen: {workout_count:,}")


def fmt(value: Any, decimals: int = 2) -> Any:
    if value is None or value == "":
        return ""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return value
    if abs(f) < 1e-12:
        return ""
    return round(f, decimals)


def write_daily_csv(path: Path, daily: Dict[str, Dict[str, float]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=DAILY_COLUMNS)
        writer.writeheader()
        for day in sorted(daily.keys()):
            row = {"date": day}
            data = daily[day]
            for col in DAILY_COLUMNS:
                if col == "date":
                    continue
                decimals = 0 if col in {"steps", "workout_count"} else 2
                row[col] = fmt(data.get(col, 0.0), decimals)
            writer.writerow(row)


def iso_week_start(day_str: str) -> date:
    d = date.fromisoformat(day_str)
    return d - timedelta(days=d.weekday())


def write_weekly_csv(path: Path, daily: Dict[str, Dict[str, float]]) -> None:
    # Sum additive metrics; average daily metrics over days with values.
    additive = {
        "steps",
        "active_energy_kcal",
        "exercise_minutes",
        "walking_running_distance_km",
        "workout_count",
        "workout_minutes",
        "workout_energy_kcal",
        "workout_distance_km",
        "sleep_asleep_hours",
        "sleep_in_bed_hours",
    }
    averaged = {"body_weight_kg", "resting_hr_bpm", "hrv_sdnn_ms", "vo2max"}

    weeks: Dict[date, Dict[str, float]] = defaultdict(lambda: defaultdict(float))
    counts: Dict[Tuple[date, str], int] = defaultdict(int)
    days_in_week: Dict[date, set] = defaultdict(set)

    for day_str, data in daily.items():
        wk = iso_week_start(day_str)
        days_in_week[wk].add(day_str)
        for col in additive:
            weeks[wk][col] += float(data.get(col, 0.0) or 0.0)
        for col in averaged:
            v = float(data.get(col, 0.0) or 0.0)
            if v:
                weeks[wk][col] += v
                counts[(wk, col)] += 1

    columns = [
        "week_start",
        "days_with_data",
        "avg_daily_steps",
        "total_steps",
        "avg_daily_active_energy_kcal",
        "total_active_energy_kcal",
        "total_exercise_minutes",
        "total_workout_count",
        "total_workout_minutes",
        "avg_sleep_asleep_hours",
        "avg_body_weight_kg",
        "avg_resting_hr_bpm",
        "avg_hrv_sdnn_ms",
        "avg_vo2max",
    ]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for wk in sorted(weeks.keys()):
            days = max(len(days_in_week[wk]), 1)
            row = {
                "week_start": wk.isoformat(),
                "days_with_data": days,
                "avg_daily_steps": round(weeks[wk]["steps"] / days, 0),
                "total_steps": round(weeks[wk]["steps"], 0),
                "avg_daily_active_energy_kcal": round(weeks[wk]["active_energy_kcal"] / days, 1),
                "total_active_energy_kcal": round(weeks[wk]["active_energy_kcal"], 1),
                "total_exercise_minutes": round(weeks[wk]["exercise_minutes"], 1),
                "total_workout_count": round(weeks[wk]["workout_count"], 0),
                "total_workout_minutes": round(weeks[wk]["workout_minutes"], 1),
                "avg_sleep_asleep_hours": round(weeks[wk]["sleep_asleep_hours"] / days, 2),
            }
            for col, out_col in [
                ("body_weight_kg", "avg_body_weight_kg"),
                ("resting_hr_bpm", "avg_resting_hr_bpm"),
                ("hrv_sdnn_ms", "avg_hrv_sdnn_ms"),
                ("vo2max", "avg_vo2max"),
            ]:
                c = counts[(wk, col)]
                row[out_col] = round(weeks[wk][col] / c, 2) if c else ""
            writer.writerow(row)


def write_workouts_csv(path: Path, workouts: list) -> None:
    columns = ["date", "start", "end", "type", "duration_minutes", "energy_kcal", "distance_km", "source"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for row in sorted(workouts, key=lambda r: (r["date"], r["start"])):
            writer.writerow(row)


def write_source_summary_csv(path: Path, source_summary: Dict[Tuple[str, str], Dict[str, float]]) -> None:
    columns = ["record_type", "source", "records", "raw_value_sum"]
    rows = []
    for (record_type, source), data in source_summary.items():
        rows.append(
            {
                "record_type": record_type,
                "source": source,
                "records": int(data["records"]),
                "raw_value_sum": round(data["value_sum"], 2),
            }
        )
    rows.sort(key=lambda r: (r["record_type"], -r["records"], r["source"]))
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        writer.writerows(rows)


def parse_date_arg(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    return date.fromisoformat(value)


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarise Apple Health export.xml/export.zip into CSV files.")
    parser.add_argument("input", help="Path to Apple Health export.xml or export.zip")
    parser.add_argument("--out", default="apple_health_summary", help="Output folder name")
    parser.add_argument("--since", help="Only include records on/after YYYY-MM-DD")
    parser.add_argument("--until", help="Only include records on/before YYYY-MM-DD")
    parser.add_argument(
        "--source",
        help="Optional sourceName filter, e.g. 'Apple Watch' or 'Paul’s Apple Watch'. Useful if steps look duplicated.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    parse_export(
        input_path=input_path,
        out_dir=Path(args.out),
        since=parse_date_arg(args.since),
        until=parse_date_arg(args.until),
        source_contains=args.source,
    )


if __name__ == "__main__":
    main()
