"""Lyrics adaptation for Filey's audio specialization.

Lyrics are stored in the Lyrica row format ``[text, speed, delay]`` where
``speed`` is the seconds taken per character and ``delay`` is the second at
which the line starts. Users may provide that format directly (JSON), an LRC
file, or plain text; everything is normalized to rows.
"""

import json
import re

DEFAULT_SPEED = 0.08
MIN_SPEED = 0.02
MAX_SPEED = 0.4
LINE_GAP = 1.5
MAX_LINES = 2000
MAX_TEXT = 500

_STAMP = re.compile(r'^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]')
_WORD_STAMP = re.compile(r'<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>')
_META_TAG = re.compile(r'^\[[a-z]+:.*\]$', re.IGNORECASE)


class LyricsError(ValueError):
    pass


def _clamp(value, low, high):
    return max(low, min(high, value))


def validate_rows(rows):
    """Validate user supplied ``[text, speed, delay]`` rows and return clean rows."""
    if not isinstance(rows, list):
        raise LyricsError('lyrics must be a list of [text, speed, delay] rows')
    if len(rows) > MAX_LINES:
        raise LyricsError(f'lyrics are limited to {MAX_LINES} lines')
    clean = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, (list, tuple)) or len(row) != 3:
            raise LyricsError(f'line {index}: expected [text, speed, delay]')
        text, speed, delay = row
        if not isinstance(text, str):
            raise LyricsError(f'line {index}: text must be a string')
        try:
            speed = float(speed)
            delay = float(delay)
        except (TypeError, ValueError):
            raise LyricsError(f'line {index}: speed and delay must be numbers') from None
        if not (speed == speed and delay == delay) or delay < 0 or speed <= 0:
            raise LyricsError(f'line {index}: speed must be > 0 and delay >= 0')
        text = text.replace('\r', '').strip()
        if not text:
            continue
        if len(text) > MAX_TEXT:
            raise LyricsError(f'line {index}: text is longer than {MAX_TEXT} characters')
        clean.append([text, round(speed, 3), round(delay, 3)])
    clean.sort(key=lambda row: row[2])
    return clean


def from_text(text, speed=DEFAULT_SPEED, start=0.0):
    """Lay plain text lines out one after another using a fixed typing speed."""
    rows = []
    clock = float(start)
    for line in str(text).replace('\r', '').split('\n'):
        line = line.strip()
        if not line:
            continue
        rows.append([line, speed, round(clock, 3)])
        clock += len(line) * speed + LINE_GAP
    return validate_rows(rows)


def from_lrc(text):
    """Convert timestamped LRC lines; speed is derived so a line ends before the next."""
    entries = []
    offset = 0.0
    for raw in str(text).replace('\r', '').split('\n'):
        line = raw.strip()
        offset_match = re.match(r'^\[offset:\s*([+-]?\d+)\s*\]$', line, re.IGNORECASE)
        if offset_match:
            offset = int(offset_match.group(1)) / 1000
            continue
        if not line or (_META_TAG.match(line) and not _STAMP.match(line)):
            continue
        stamps = []
        rest = line
        while True:
            match = _STAMP.match(rest)
            if not match:
                break
            fraction = float(f'0.{match.group(3).ljust(3, "0")}') if match.group(3) else 0.0
            stamps.append(int(match.group(1)) * 60 + int(match.group(2)) + fraction)
            rest = rest[match.end():]
        lyric = _WORD_STAMP.sub('', rest).strip()
        if stamps and lyric:
            entries.extend((lyric, stamp) for stamp in stamps)
    entries.sort(key=lambda entry: entry[1])
    rows = []
    for index, (lyric, start) in enumerate(entries):
        start = max(0.0, start + offset)
        if index + 1 < len(entries):
            window = max(0.5, entries[index + 1][1] - entries[index][1])
            speed = _clamp(window * 0.8 / len(lyric), MIN_SPEED, MAX_SPEED)
        else:
            speed = DEFAULT_SPEED
        rows.append([lyric, round(speed, 3), round(start, 3)])
    return validate_rows(rows)


def _json_rows(text):
    """Read row JSON leniently: missing outer brackets, trailing commas, rows on separate lines.

    Returns a list of rows, or None when the text is not JSON rows at all.
    """
    body = text.strip()
    candidates = [body]
    glued = re.sub(r'\]\s*,?\s*\[', '],[', body)
    for variant in (body, glued):
        trimmed = re.sub(r',\s*$', '', variant)
        candidates.append(f'[{trimmed}]')
        candidates.append(re.sub(r',(\s*[\]}])', r'\1', trimmed))
    for candidate in candidates:
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            value = value.get('lyrics', value.get('lines'))
        if not isinstance(value, list):
            continue
        if value and not any(isinstance(item, (list, tuple, dict)) for item in value):
            value = [value]  # a single bare row
        if all(isinstance(item, (list, tuple)) for item in value):
            return value
    return None


def parse(source, fmt='auto'):
    """Normalize rows, JSON text, LRC text or plain text into validated rows."""
    if isinstance(source, list):
        return validate_rows(source)
    text = str(source or '').strip()
    if not text:
        return []
    if fmt in ('auto', 'json') and text[0] in '[{':
        rows = _json_rows(text)
        if rows is not None:
            return validate_rows(rows)
        if fmt == 'json':
            raise LyricsError('lyrics JSON is not valid')
    if fmt in ('auto', 'lrc') and any(
            _STAMP.match(line.strip()) for line in text.splitlines()):
        return from_lrc(text)
    return from_text(text)
