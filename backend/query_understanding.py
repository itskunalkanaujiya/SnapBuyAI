"""
Understand a typed shopping request.

"a laptop of 8gb ram with 500gb storage and company hp" becomes:
product "laptop", brand "hp", specs 8 GB RAM and 500 GB storage, and the
search query "hp laptop 8GB RAM 500GB". Listings are then ranked by how many
of the requested specs their titles meet, and a budget ("under 50k") is
applied as a hard limit.
"""

import re
from dataclasses import dataclass, field

# Brands people name in shopping requests (lower case). Used to recognise a
# brand written without "brand"/"company" in front of it.
KNOWN_BRANDS = {
    "hp", "dell", "lenovo", "asus", "acer", "apple", "msi", "samsung", "mi",
    "xiaomi", "redmi", "poco", "realme", "oneplus", "vivo", "oppo", "iqoo",
    "motorola", "nokia", "google", "pixel", "nothing", "infinix", "tecno",
    "sony", "lg", "panasonic", "philips", "boat", "noise", "jbl", "bose",
    "sennheiser", "skullcandy", "zebronics", "titan", "fastrack", "casio",
    "fossil", "timex", "sonata", "amazfit", "fireboltt", "nike", "adidas",
    "puma", "reebok", "skechers", "bata", "woodland", "campus", "levis",
    "wrangler", "allen", "peter", "van", "raymond", "biba", "libas", "aurelia",
    "whirlpool", "godrej", "haier", "voltas", "daikin", "bluestar", "ifb",
    "bajaj", "havells", "prestige", "pigeon", "milton", "canon", "nikon",
    "gopro", "logitech", "hyperx", "redragon", "intel", "amd", "microsoft",
    "lakme", "maybelline", "mamaearth", "nivea", "ray-ban", "rayban",
    "lenskart", "vincent", "wildcraft", "skybags", "safari", "american",
}

# Words that only carry the sentence ("i want a ... with ...").
FILLER_WORDS = {
    "i", "want", "need", "looking", "look", "for", "show", "me", "find", "get",
    "buy", "a", "an", "the", "of", "with", "and", "having", "has", "have",
    "that", "which", "is", "are", "to", "in", "on", "my", "please", "some",
    "any", "one", "good", "best", "nice", "new", "latest", "top", "quality",
    "company", "brand", "made", "by", "from", "price", "priced", "cost",
    "costing", "rs", "inr", "rupees", "rupee", "budget", "range", "around",
    "under", "below", "within", "upto", "up", "max", "maximum", "less", "than",
    "between", "above", "over", "more", "minimum", "min", "atleast", "least",
    "at", "approx", "approximately", "about", "or", "it", "should", "be",
    "also", "like", "type", "model", "version", "variant", "option", "options",
    "storage", "memory", "ram", "rom", "internal", "screen", "display",
    "battery", "camera", "processor", "capacity", "size",
}

AUDIENCE = {
    "men": "men", "man": "men", "mens": "men", "male": "men", "boys": "boys",
    "boy": "boys", "women": "women", "woman": "women", "womens": "women",
    "ladies": "women", "lady": "women", "female": "women", "girls": "girls",
    "girl": "girls", "kids": "kids", "kid": "kids", "children": "kids",
    "unisex": "unisex",
}
COLOURS = {
    "black", "white", "blue", "navy", "green", "red", "maroon", "pink",
    "yellow", "grey", "gray", "silver", "gold", "golden", "brown", "beige",
    "orange", "purple", "violet", "cream", "olive", "teal", "rose",
}

UPPER_FEATURES = {"4g", "5g", "4k", "8k", "fhd", "qled", "oled", "amoled"}

NUMBER = r"(\d+(?:\.\d+)?)"
MONEY = r"(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|lakh|lac|l)?\b"


@dataclass
class Spec:
    kind: str  # ram, storage, screen, battery, camera, refresh, power, ...
    value: float  # in the base unit: GB, inch, mAh, MP, Hz, W, litre, kg, ton
    label: str  # shown to the user, e.g. "8 GB RAM"
    query: str  # added to the search query, e.g. "8GB RAM"


@dataclass
class ParsedQuery:
    raw: str
    product: str = ""
    brand: str | None = None
    specs: list[Spec] = field(default_factory=list)
    features: list[str] = field(default_factory=list)  # e.g. "i5", "5g", "4k"
    colour: str | None = None
    audience: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    # Set when a language model read the request (llm_query_parser):
    wishes: list[str] = field(default_factory=list)  # soft, e.g. "gaming"
    model_query: str | None = None  # the model's suggested search query
    read_by_model: bool = False

    @property
    def search_query(self):
        """What to send to Google Shopping."""
        if self.model_query:
            query = self.model_query
            if self.brand and self.brand.replace("-", "") not in query.replace("-", ""):
                query = f"{self.brand} {query}"
            # Google Shopping understands budgets in the query, which brings
            # more listings within it.
            if self.max_price and "under" not in query and "below" not in query:
                query = f"{query} under {self.max_price:.0f}"
            return query
        parts = [self.brand, self.colour, self.audience, self.product, *self.features, *self.wishes]
        parts += [spec.query for spec in self.specs]
        return " ".join(part for part in parts if part) or self.raw

    @property
    def core_query(self):
        """Words a matching title should contain (specs are scored separately)."""
        parts = [self.brand, self.colour, self.audience, self.product, *self.features]
        return " ".join(part for part in parts if part) or self.raw

    @property
    def is_structured(self):
        """True when the request had more than plain keywords."""
        return bool(
            self.specs or self.min_price or self.max_price or self.brand_named or self.read_by_model
        )

    brand_named: bool = False  # the brand was introduced with "brand"/"company"

    def summary(self):
        """Readable parts for the results page, in display order."""
        parts = []
        if self.brand:
            parts.append(self.brand.upper() if len(self.brand) <= 3 else self.brand.title())
        if self.product:
            product = self.product.upper() if len(self.product) <= 2 else self.product
            parts.append(product[:1].upper() + product[1:])
        parts += [feature.upper() if feature in UPPER_FEATURES else feature for feature in self.features]
        parts += [spec.label for spec in self.specs]
        parts += [wish[:1].upper() + wish[1:] for wish in self.wishes]
        if self.colour:
            parts.append(self.colour.title())
        if self.audience:
            parts.append(f"For {self.audience}")
        if self.min_price and self.max_price:
            parts.append(f"₹{self.min_price:,.0f}–₹{self.max_price:,.0f}")
        elif self.max_price:
            parts.append(f"Under ₹{self.max_price:,.0f}")
        elif self.min_price:
            parts.append(f"Above ₹{self.min_price:,.0f}")
        return parts


def _money(amount, suffix):
    value = float(amount.replace(",", ""))
    suffix = (suffix or "").lower()
    if suffix in {"k", "thousand"}:
        value *= 1_000
    elif suffix in {"lakh", "lac", "l"}:
        value *= 100_000
    return value


def _gb(value, unit):
    return float(value) * (1024 if unit.lower() == "tb" else 1)


def _size_label(gb):
    return f"{gb / 1024:g} TB" if gb >= 1024 and gb % 1024 == 0 else f"{gb:g} GB"


def _size_query(gb):
    return f"{gb / 1024:g}TB" if gb >= 1024 and gb % 1024 == 0 else f"{gb:g}GB"


# Spec patterns: (kind, regex, builder). Each regex is removed from the text
# once read, so later patterns don't read the same words again.
def _spec_patterns():
    size = r"(\d+(?:\.\d+)?)\s*(gb|tb)"
    return [
        ("ram", rf"{size}\s*(?:of\s+)?(?:ram|memory|ddr\d?)\b", lambda m: _gb(m[1], m[2])),
        ("ram", rf"\b(?:ram|memory)\s*(?:of|is|:)?\s*{size}", lambda m: _gb(m[1], m[2])),
        ("storage", rf"{size}\s*(?:of\s+)?(?:storage|ssd|hdd|rom|internal|space|hard\s*disk)\b", lambda m: _gb(m[1], m[2])),
        ("storage", rf"\b(?:storage|ssd|hdd|rom|hard\s*disk)\s*(?:of|is|:)?\s*{size}", lambda m: _gb(m[1], m[2])),
        ("screen", rf"{NUMBER}\s*(?:-|\s)?(?:inch(?:es)?|in\b|\"|”)", lambda m: float(m[1])),
        ("battery", rf"{NUMBER}\s*mah\b", lambda m: float(m[1])),
        ("camera", rf"{NUMBER}\s*mp\b", lambda m: float(m[1])),
        ("refresh", rf"{NUMBER}\s*hz\b", lambda m: float(m[1])),
        ("power", rf"{NUMBER}\s*(?:w|watts?)\b", lambda m: float(m[1])),
        ("volume", rf"{NUMBER}\s*(?:l|litres?|liters?|ltr)\b", lambda m: float(m[1])),
        ("weight", rf"{NUMBER}\s*kg\b", lambda m: float(m[1])),
        ("tonnage", rf"{NUMBER}\s*tons?\b", lambda m: float(m[1])),
    ]


SPEC_FORMAT = {
    "ram": (lambda v: f"{_size_label(v)} RAM", lambda v: f"{_size_query(v)} RAM"),
    "storage": (lambda v: f"{_size_label(v)} storage", lambda v: _size_query(v)),
    "screen": (lambda v: f'{v:g}" screen', lambda v: f"{v:g} inch"),
    "battery": (lambda v: f"{v:g} mAh", lambda v: f"{v:g}mAh"),
    "camera": (lambda v: f"{v:g} MP camera", lambda v: f"{v:g}MP"),
    "refresh": (lambda v: f"{v:g} Hz", lambda v: f"{v:g}Hz"),
    "power": (lambda v: f"{v:g} W", lambda v: f"{v:g}W"),
    "volume": (lambda v: f"{v:g} L", lambda v: f"{v:g}L"),
    "weight": (lambda v: f"{v:g} kg", lambda v: f"{v:g}kg"),
    "tonnage": (lambda v: f"{v:g} ton", lambda v: f"{v:g} ton"),
}

# Processors, connectivity and resolution: kept as words that must match.
FEATURE_PATTERN = re.compile(
    r"\b(i[3579](?:\s*\d{1,2}(?:th|nd|rd|st)\s*gen)?|ryzen\s*[3579]|m[1-4](?:\s*(?:pro|max))?|"
    r"snapdragon(?:\s*\d+)?|dimensity(?:\s*\d+)?|[45]g|4k|8k|full\s*hd|fhd|qled|oled|amoled|"
    r"rtx\s*\d{4}|gtx\s*\d{4}|[1-5]\s*star)\b"
)


def parse_query(raw):
    """Read product, brand, specs, budget, colour and audience from a request."""
    text = " " + (raw or "").lower().replace("–", "-") + " "
    parsed = ParsedQuery(raw=(raw or "").strip())

    # Budget first, so "under 50k" isn't read as anything else.
    budget_patterns = [
        (rf"\bbetween\s+{MONEY}\s*(?:and|to|-)\s*{MONEY}", "between"),
        (rf"\b{MONEY}\s*(?:to|-)\s*{MONEY}\s*(?:range|budget)?", "between"),
        (rf"\b(?:under|below|within|upto|up\s+to|less\s+than|max(?:imum)?|budget(?:\s+of)?|not\s+more\s+than)\s+{MONEY}", "max"),
        (rf"\b(?:above|over|more\s+than|min(?:imum)?|at\s*least|atleast|starting(?:\s+from)?)\s+{MONEY}", "min"),
        (rf"\b(?:around|about|approx(?:imately)?|near)\s+{MONEY}", "around"),
    ]
    for pattern, kind in budget_patterns:
        match = re.search(pattern, text)
        if not match:
            continue
        if kind == "between":
            low, high = _money(match[1], match[2]), _money(match[3], match[4])
            parsed.min_price, parsed.max_price = min(low, high), max(low, high)
        elif kind == "max":
            parsed.max_price = _money(match[1], match[2])
        elif kind == "min":
            parsed.min_price = _money(match[1], match[2])
        else:
            value = _money(match[1], match[2])
            parsed.min_price, parsed.max_price = value * 0.8, value * 1.2
        text = text[:match.start()] + " " + text[match.end():]
        break

    # Specs with units.
    seen = set()
    for kind, pattern, read in _spec_patterns():
        for match in list(re.finditer(pattern, text)):
            if kind in seen:
                break
            value = read(match)
            label, query = SPEC_FORMAT[kind]
            parsed.specs.append(Spec(kind, value, label(value), query(value)))
            seen.add(kind)
        text = re.sub(pattern, " ", text)

    # A bare size ("8gb", "512 gb") without saying RAM or storage: small
    # sizes are RAM, large ones storage.
    for match in re.finditer(r"(\d+(?:\.\d+)?)\s*(gb|tb)\b", text):
        value = _gb(match[1], match[2])
        kind = "ram" if value <= 32 else "storage"
        if kind not in seen:
            label, query = SPEC_FORMAT[kind]
            parsed.specs.append(Spec(kind, value, label(value), query(value)))
            seen.add(kind)
    text = re.sub(r"(\d+(?:\.\d+)?)\s*(gb|tb)\b", " ", text)

    # Brand introduced explicitly: "company hp", "brand hp", "by hp", "hp company".
    match = re.search(r"\b(?:company|brand|make|made\s+by|by|from)\s*(?:is|:|-)?\s*([a-z][a-z0-9&-]*)", text)
    if match and match[1] not in FILLER_WORDS:
        parsed.brand, parsed.brand_named = match[1], True
        text = text[:match.start()] + " " + text[match.end():]
    else:
        match = re.search(r"\b([a-z][a-z0-9&-]*)\s+(?:company|brand|make)\b", text)
        if match and match[1] not in FILLER_WORDS:
            parsed.brand, parsed.brand_named = match[1], True
            text = text[:match.start()] + " " + text[match.end():]

    # Processor, network, resolution.
    for match in FEATURE_PATTERN.finditer(text):
        parsed.features.append(re.sub(r"\s+", " ", match[1]).strip())
    text = FEATURE_PATTERN.sub(" ", text)

    words = re.findall(r"[a-z0-9][a-z0-9&'-]*", text)
    product_words = []
    for word in words:
        bare = word.replace("'s", "").replace("'", "")
        if bare in AUDIENCE and not parsed.audience:
            parsed.audience = AUDIENCE[bare]
        elif bare in COLOURS and not parsed.colour:
            parsed.colour = bare
        elif not parsed.brand and bare.replace("-", "") in {b.replace("-", "") for b in KNOWN_BRANDS}:
            parsed.brand = bare
        elif bare not in FILLER_WORDS:
            product_words.append(word)
    parsed.product = " ".join(product_words)
    return parsed


# --------------------------------------------------
# Matching listings against the request
# --------------------------------------------------

SIZE_IN_TITLE = re.compile(r"(\d+(?:\.\d+)?)\s*(gb|tb)\b", re.IGNORECASE)


def _title_sizes(title):
    """(size in GB, followed by "RAM"?) for every size written in a title."""
    sizes = []
    for match in SIZE_IN_TITLE.finditer(title):
        after = title[match.end():match.end() + 12].lower()
        sizes.append((_gb(match[1], match[2]), bool(re.match(r"\s*(?:of\s+)?(?:ram|ddr|lpddr|memory)", after))))
    return sizes


def _numbers_before(title, unit_pattern):
    return [float(m[1]) for m in re.finditer(rf"(\d+(?:\.\d+)?)\s*{unit_pattern}", title, re.IGNORECASE)]


def spec_match(spec, title):
    """1 for a match, 0.5 for close (e.g. more storage than asked), 0 for none."""
    if spec.kind in {"ram", "storage"}:
        sizes = _title_sizes(title)
        if spec.kind == "ram":
            ram = [gb for gb, labelled in sizes if labelled] or [gb for gb, _ in sizes if gb <= 64][:1]
            if spec.value in ram:
                return 1.0
            return 0.5 if any(gb > spec.value for gb in ram) else 0.0
        storage = [gb for gb, labelled in sizes if not labelled and gb >= 32]
        if any(abs(gb - spec.value) <= spec.value * 0.15 for gb in storage):
            return 1.0  # 500 GB asked, 512 GB listed
        return 0.5 if any(gb > spec.value for gb in storage) else 0.0

    units = {
        "screen": r"(?:-|\s)?(?:inch(?:es)?|in\b|\"|”|cm)",
        "battery": r"mah\b",
        "camera": r"mp\b",
        "refresh": r"hz\b",
        "power": r"(?:w|watts?)\b",
        "volume": r"(?:l|litres?|liters?|ltr)\b",
        "weight": r"kg\b",
        "tonnage": r"tons?\b",
    }
    values = _numbers_before(title, units[spec.kind])
    if spec.kind == "screen":
        # Listings often give centimetres too: 39.6 cm = 15.6".
        values = [v / 2.54 if v > 30 else v for v in values]
        return 1.0 if any(abs(v - spec.value) <= 0.6 for v in values) else 0.0
    if any(abs(v - spec.value) <= spec.value * 0.1 for v in values):
        return 1.0
    higher_is_better = spec.kind in {"battery", "camera", "refresh"}
    return 0.5 if higher_is_better and any(v > spec.value for v in values) else 0.0


def requirements_score(parsed, title, store=""):
    """
    Share of the requested specs, brand and features a listing meets (0-1),
    or None when the request had none.
    """
    checks = []
    lowered = (title or "").lower()
    if parsed.brand:
        brand = parsed.brand.replace("-", "")
        compact = re.sub(r"[\s-]", "", lowered)
        checks.append(1.0 if brand in compact or brand in (store or "").lower().replace(" ", "") else 0.0)
    for feature in parsed.features:
        checks.append(1.0 if re.sub(r"\s+", "", feature) in re.sub(r"\s+", "", lowered) else 0.0)
    for spec in parsed.specs:
        checks.append(spec_match(spec, title or ""))
    return round(sum(checks) / len(checks), 4) if checks else None
