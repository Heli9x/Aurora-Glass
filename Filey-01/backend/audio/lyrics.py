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


def has_stamps(text):
    return any(_STAMP.match(line.strip()) for line in str(text).splitlines())


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


LEAD_RATIO = 0.06      # share of the song assumed to pass before the first line
TAIL_RATIO = 0.05      # share assumed to remain after the last line
MAX_LEAD = 15.0
LINE_PAUSE = 12        # breathing room after each line, in characters' worth of time
STANZA_PAUSE = 40      # extra room where the text has a blank line (verse/chorus break)
HEADER_WEIGHT = 2      # section markers such as [Chorus] barely take any time


def _text_lines(text):
    """Non-empty lines, each flagged with whether a blank line preceded it."""
    lines = []
    gap = False
    for raw in str(text).replace('\r', '').split('\n'):
        line = raw.strip()
        if not line:
            gap = bool(lines)
            continue
        lines.append((line, gap))
        gap = False
    return lines


def _is_header(line):
    return bool(re.match(r'^[\[(][^\]\d)][^\])]*[\])]$', line))


def estimate(lines, duration):
    """Spread untimed lines over the song, weighting by length and stanza breaks.

    ``lines`` holds ``(text, blank_line_before)`` pairs. Without real timestamps
    this is a best guess: the first line is placed after a short intro, the last
    before a short outro, and the time between goes to each line in proportion
    to its length.
    """
    lead = min(MAX_LEAD, duration * LEAD_RATIO)
    span = max(duration - lead - min(MAX_LEAD, duration * TAIL_RATIO), duration * 0.5)
    weights = [(HEADER_WEIGHT if _is_header(line) else len(line) + LINE_PAUSE,
                STANZA_PAUSE if gap else 0) for line, gap in lines]
    unit = span / sum(weight + pause for weight, pause in weights)
    speed = _clamp(unit, MIN_SPEED, MAX_SPEED)
    rows = []
    clock = 0.0
    for (line, _), (weight, pause) in zip(lines, weights):
        clock += pause
        rows.append([line, round(speed, 3), round(lead + clock * unit, 3)])
        clock += weight
    return validate_rows(rows)


def from_text(text, speed=DEFAULT_SPEED, start=0.0, duration=None):
    """Lay plain text lines out over the song when its length is known, else one after another."""
    lines = _text_lines(text)
    if duration and duration > 0 and lines:
        return estimate(lines, float(duration))
    rows = []
    clock = float(start)
    for line, _ in lines:
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
        start = max(0.0, start - offset)  # [offset:+n] shows lyrics n ms sooner
        if index + 1 < len(entries):
            window = max(0.5, entries[index + 1][1] - entries[index][1])
            speed = _clamp(window * 0.8 / len(lyric), MIN_SPEED, MAX_SPEED)
        else:
            speed = DEFAULT_SPEED
        rows.append([lyric, round(speed, 3), round(start, 3)])
    return validate_rows(rows)


_NUMBER = r"""["']?(?P<%s>[-+]?(?:\d+\.?\d*|\.\d+))["']?"""
_ROW = re.compile(
    r"""[\[(]\s*(?:"(?P<dq>[^\n]*?)"|'(?P<sq>[^\n]*?)')\s*,\s*"""
    + _NUMBER % 'speed' + r"""\s*,\s*""" + _NUMBER % 'delay' + r"""\s*[\])]""")


def _unescape(text):
    return re.sub(r'\\(["\'\\])', r'\1', text).replace('\\n', ' ')


def _extract_rows(text):
    """Pull ``[text, speed, delay]`` rows out of JSON-ish text.

    Tolerates what hand-written or Python-exported files contain: missing outer
    brackets, trailing commas, rows without commas between them, single quotes,
    tuples, ``lyrics = [...]`` assignments, comments, smart quotes, unescaped
    inner quotes and numbers like ``.6``.
    """
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    return [[_unescape(match.group('dq') if match.group('dq') is not None else match.group('sq')),
             match.group('speed'), match.group('delay')]
            for match in _ROW.finditer(text)]


def _strict_rows(text):
    """Rows from standards-compliant JSON, or None when it is not row-shaped JSON."""
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    if isinstance(value, dict):
        value = value.get('lyrics', value.get('lines'))
    if isinstance(value, list) and value and all(
            isinstance(row, list) and row and isinstance(row[0], str) for row in value):
        return value
    return None


def parse(source, fmt='auto', duration=None):
    """Normalize rows, JSON text, LRC text or plain text into validated rows."""
    if isinstance(source, list):
        return validate_rows(source)
    text = str(source or '').lstrip('\ufeff').strip()
    if not text:
        return []
    if fmt in ('auto', 'json'):
        rows = _strict_rows(text) if text[0] in '[{' else None
        if rows is None:
            rows = _extract_rows(text)
        if rows:
            return validate_rows(rows)
        if fmt == 'json':
            raise LyricsError('no [text, speed, delay] rows found in the lyrics JSON')
    if fmt in ('auto', 'lrc') and has_stamps(text):
        return from_lrc(text)
    return from_text(text, duration=duration)
