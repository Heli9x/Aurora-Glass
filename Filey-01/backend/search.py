"""Search helpers for the media index.

Matching is intentionally simple and dependency-free: whitespace-separated
terms, case-insensitive substring matching, all terms must match (AND). The
functions operate on the public record dicts produced by
``MediaLibrary.read_files`` so search can be unit-tested without touching disk.
"""


def parse_query(raw):
    return [term for term in str(raw or '').lower().split() if term]


def _fields(record):
    fields = [
        record.get('name'),
        record.get('originalName'),
        record.get('type'),
        record.get('categoryLabel'),
        record.get('ext'),
    ]
    tags = record.get('tags') or []
    if isinstance(tags, (list, tuple, set)):
        fields.extend(tags)
    elif tags:
        fields.append(tags)
    return [str(field).lower() for field in fields if field]


def match_record(record, terms):
    if not terms:
        return True
    haystack = ' \n '.join(_fields(record))
    return all(term in haystack for term in terms)


def highlight(text, terms):
    """Return [(start, end), ...] ranges of the first match per term in text."""
    if not text or not terms:
        return []
    lowered = text.lower()
    ranges = []
    for term in terms:
        start = lowered.find(term)
        if start < 0:
            continue
        ranges.append((start, start + len(term)))
    ranges.sort()
    return ranges
