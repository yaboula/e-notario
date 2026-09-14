"""Reading lines over immutable OCR words in canonical coordinates."""
from statistics import median

from cnie_ocr.domain import OcrWord


def center(word: OcrWord) -> tuple[float, float]:
    points = word.bounding_box
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def height(word: OcrWord) -> float:
    return max(p[1] for p in word.bounding_box) - min(p[1] for p in word.bounding_box)


def reading_lines(words: list[OcrWord], rtl: bool = False) -> list[list[OcrWord]]:
    rows: list[list[OcrWord]] = []
    for word in sorted(words, key=lambda w: (center(w)[1], center(w)[0], w.text)):
        y = center(word)[1]
        candidates = []
        for i, row in enumerate(rows):
            delta = abs(y - median(center(w)[1] for w in row))
            tolerance = min(28, max(10, min(height(word), median(height(w) for w in row)) * .55))
            if delta <= tolerance:
                candidates.append((delta, i))
        if candidates:
            rows[min(candidates)[1]].append(word)
        else:
            rows.append([word])
    return [sorted(row, key=lambda w: center(w)[0], reverse=rtl) for row in rows]


def join_lines(words: list[OcrWord], rtl: bool = False) -> str:
    return "\n".join(" ".join(w.text for w in row) for row in reading_lines(words, rtl))
