"""MVP roster: which community colleges, transfer targets, majors, and year
we scrape/index for the initial rollout. IDs are ASSIST institution ids
(see metadata/institutions.json for the full list).
"""

MVP_SENDING_IDS = [
    62   # Mount San Antonio College (MTSAC)
    # 64,   # Rio Hondo College
    # 49,   # Pasadena City College
    # 113,  # De Anza College
    # 137,  # Santa Monica College
    # 134,  # Fullerton College
]

MVP_RECEIVING_IDS = [
    # 79,   # UC Berkeley
    # 89,   # UC Davis
    # 120,  # UC Irvine
    # 117,  # UCLA
    # 144,  # UC Merced
    # 46,   # UC Riverside
    7    # UC San Diego
    # 128,  # UC Santa Barbara
    # 132,  # UC Santa Cruz
    # 75,   # Cal Poly Pomona
    # 129,  # CSU Fullerton
    # 81,   # CSU Long Beach
    # 11,   # Cal Poly SLO
]

MVP_MAJOR_FILTERS = [
    "electrical engineering",
    # "computer engineering",
    # "computer science",
    # "data science",
    # "physics",
    # "mathematics",
    # "mechanical engineering",
    # "chemical engineering",
    # "civil engineering",
    # "bioengineering",
    # "aerospace",
    # "materials science",
]

MVP_YEAR_ID = 76  # 2026-27
