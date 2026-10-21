"""Allow-listed snapshot validation compatible with core.js validateBackup."""

import re
from datetime import date

ALLOWED = {"meds", "events", "logs", "dailyEntries", "name", "contact", "pharmacyName", "pharmacyPhone", "hideMedicationNameInNotification"}
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
STATUSES = {"taken", "taken_late", "skipped"}
TEXT_LIMITS = {"id": 128, "name": 200, "title": 200, "type": 80, "strength": 100, "medId": 128, "medName": 200, "time": 5, "note": 4000, "contact": 200, "pharmacyName": 200, "pharmacyPhone": 40, "mood": 80, "questions": 4000, "updatedAt": 64, "at": 64}


class PayloadError(ValueError):
    pass


def _text(value, key, *, default=""):
    if not isinstance(value, str) or len(value) > TEXT_LIMITS.get(key, 4000):
        raise PayloadError("Um texto do backup está inválido ou é muito longo.")
    return value


def _date(value):
    if not isinstance(value, str) or not DATE.fullmatch(value):
        raise PayloadError("Uma data do backup está inválida.")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise PayloadError("Uma data do backup está inválida.") from exc
    return value


def _number(value, *, positive=False, nonnegative=False, default=None):
    if value is None and default is not None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PayloadError("Um valor numérico do backup está inválido.")
    if value != value or value in (float("inf"), float("-inf")) or (positive and value <= 0) or (nonnegative and value < 0):
        raise PayloadError("Um valor numérico do backup está inválido.")
    return value


def validate_payload(value):
    if not isinstance(value, dict):
        raise PayloadError("O conteúdo da sincronização precisa ser um objeto JSON.")
    for key in ("meds", "events", "logs"):
        if not isinstance(value.get(key), list):
            raise PayloadError(f"A lista {key} está inválida.")
    meds, events, logs = [], [], []
    for med in value["meds"]:
        if not isinstance(med, dict) or not isinstance(med.get("id"), str) or not isinstance(med.get("name"), str) or med.get("mode") not in {"daily", "asneeded"}:
            raise PayloadError("Um medicamento está incompleto.")
        stock = _number(med.get("stock"), nonnegative=True)
        schedule_src = med.get("schedule")
        if schedule_src is None:
            times = med.get("times", [])
            if not isinstance(times, list):
                raise PayloadError("Os horários do medicamento estão inválidos.")
            amount = _number(med.get("perDose", 1), positive=True)
            schedule_src = [{"time": time, "amount": amount} for time in times]
        if not isinstance(schedule_src, list):
            raise PayloadError("Os horários do medicamento estão inválidos.")
        schedule = []
        for item in schedule_src:
            if not isinstance(item, dict) or not isinstance(item.get("time"), str) or not TIME.fullmatch(item["time"]):
                raise PayloadError("Um horário do medicamento está inválido.")
            schedule.append({"time": item["time"], "amount": _number(item.get("amount"), positive=True)})
        times = [item["time"] for item in schedule]
        expiry = _text(med.get("prescriptionExpiry", ""), "prescriptionExpiry")
        if expiry:
            _date(expiry)
        meds.append({"id": _text(med["id"], "id"), "name": _text(med["name"], "name"), "mode": med["mode"], "strength": _text(med.get("strength", ""), "strength"), "perDose": _number(med.get("perDose", 1), positive=True), "stock": stock, "prescriptionExpiry": expiry, "schedule": schedule, "times": times})
    for event in value["events"]:
        if not isinstance(event, dict) or not isinstance(event.get("id"), str) or not isinstance(event.get("title"), str):
            raise PayloadError("Um compromisso está inválido.")
        event_date = _date(event.get("date"))
        time = event.get("time", "")
        if not isinstance(time, str) or (time and not TIME.fullmatch(time)):
            raise PayloadError("O horário do compromisso está inválido.")
        events.append({"id": _text(event["id"], "id"), "title": _text(event["title"], "title"), "type": _text(event.get("type", "Outro"), "type"), "date": event_date, "time": time, "note": _text(event.get("note", ""), "note")})
    for log in value["logs"]:
        if not isinstance(log, dict) or not isinstance(log.get("id"), str) or not isinstance(log.get("medName"), str) or log.get("status") not in STATUSES:
            raise PayloadError("Um registro de medicamento está inválido.")
        time = log.get("time", "")
        if not isinstance(time, str) or (time and not TIME.fullmatch(time)):
            raise PayloadError("O horário do registro está inválido.")
        logs.append({"id": _text(log["id"], "id"), "medId": _text(log.get("medId", ""), "medId"), "medName": _text(log["medName"], "medName"), "date": _date(log.get("date")), "time": time, "at": _text(log.get("at", ""), "at"), "status": log["status"], "amount": _number(log.get("amount", 1), positive=True), "asNeeded": log.get("asNeeded", False) if isinstance(log.get("asNeeded", False), bool) else _invalid_bool()})
    daily = value.get("dailyEntries", {})
    if not isinstance(daily, dict):
        raise PayloadError("Os registros diários estão inválidos.")
    daily_out = {}
    for key, entry in daily.items():
        _date(key)
        if not isinstance(entry, dict):
            raise PayloadError("Um registro diário está inválido.")
        daily_out[key] = {"mood": _text(entry.get("mood", ""), "mood"), "note": _text(entry.get("note", ""), "note"), "questions": _text(entry.get("questions", ""), "questions"), "updatedAt": _text(entry.get("updatedAt", ""), "updatedAt")}
    result = {"meds": meds, "events": events, "logs": logs, "dailyEntries": daily_out}
    for key in ("name", "contact", "pharmacyName", "pharmacyPhone"):
        result[key] = _text(value.get(key, ""), key)
    flag = value.get("hideMedicationNameInNotification", True)
    if not isinstance(flag, bool):
        raise PayloadError("Uma preferência do backup está inválida.")
    result["hideMedicationNameInNotification"] = flag
    return result


def _invalid_bool():
    raise PayloadError("Um registro de medicamento está inválido.")
