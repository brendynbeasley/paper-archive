"""The economics taxonomy: groups -> areas -> topics, plus the rules that tie journals to areas.

The topic keyword lists live in tax_*.py, one file per group. This module puts them in the
order the site shows them and answers two questions for the classifier:
  * which areas is a journal "at home" in (HOME)?
  * which journals publish nothing outside one area (FORCED)?
"""
import tax_theory, tax_macro, tax_finance, tax_firms, tax_people, tax_space, tax_institutions
from tax_core import GENERIC, CORE_ONLY

FIELD = 'Economics'
EXISTING_AREA = 'Monopoly & market power'      # the original bibliography; kept as it is

GROUPS = [
    ('Theory & methods', 'Models, proofs and the tools for testing them.'),
    ('Macroeconomics & international', 'Whole economies and the links between them.'),
    ('Finance', 'Asset prices, corporations and banks.'),
    ('Firms, markets & innovation', 'Competition, organization and new technology.'),
    ('Labor, people & public policy', 'Work, households and what governments do.'),
    ('Development, space & environment', 'Poor countries, cities, land and nature.'),
    ('Institutions, history & ideas', 'Politics, law, the past and the discipline itself.'),
]

AREAS = (tax_theory.AREAS + tax_macro.AREAS + tax_finance.AREAS + tax_firms.AREAS
         + tax_people.AREAS + tax_space.AREAS + tax_institutions.AREAS)

# Journal home code (journals.py) -> area codes that count as "home" for it.
HOME = {
    'micro': {'micro', 'game'}, 'game': {'game', 'micro'}, 'behavioral': {'behavioral'},
    'metrics': {'metrics'}, 'macro': {'macro', 'money', 'growth'}, 'money': {'money', 'macro', 'banking'},
    'growth': {'growth'}, 'trade': {'trade', 'intfin'}, 'intfin': {'intfin'},
    'finance': {'finance', 'corpfin', 'banking'}, 'corpfin': {'corpfin', 'finance'},
    'banking': {'banking', 'corpfin'}, 'labor': {'labor', 'education', 'family', 'inequality'},
    'education': {'education'}, 'health': {'health'}, 'public': {'public'},
    'inequality': {'inequality'}, 'family': {'family', 'labor'}, 'development': {'development'},
    'urban': {'urban'}, 'environment': {'environment'}, 'agriculture': {'agriculture', 'environment'},
    'org': {'org'}, 'innovation': {'innovation'}, 'polecon': {'polecon'}, 'law': {'law'},
    'history': {'history'}, 'thought': {'thought'}, 'culture': {'culture'},
    'io': {'org', 'innovation', 'law'}, 'complexity': set(), '': set(),
}

# Journals whose every paper belongs to one area: ISSN -> area code. A paper there that
# matches no topic goes to the area's default topic instead of being dropped.
FORCED = {
    '0022-0507': 'history', '0014-4983': 'history', '0013-0117': 'history', '1361-4916': 'history',
    '1863-2505': 'history',
    '0018-2702': 'thought', '1053-8372': 'thought', '0967-2567': 'thought', '1350-178X': 'thought',
    '0167-6296': 'health', '1057-9230': 'health', '2332-3493': 'health',
    '0272-7757': 'education', '1557-3060': 'education',
    '0095-0696': 'environment', '0924-6460': 'environment', '1750-6816': 'environment',
    '2333-5955': 'environment', '0928-7655': 'environment', '0140-9883': 'environment',
    '0195-6574': 'environment', '0921-8009': 'environment', '1941-1340': 'environment',
}
DEFAULT_TOPIC = {
    'history': 'Institutions, business & the state in history',
    'thought': 'Economists, schools & the profession',
    'health': 'Providers, hospitals & physician behavior',
    'education': 'School resources, class size & teachers',
    'environment': 'Environmental policy instruments',
}


def topics():
    """[(area dict, topic name, [phrases])] in site order."""
    return [(a, name, phrases) for a in AREAS for name, phrases in a['topics']]


def is_home_only(area_code, phrase):
    if area_code in CORE_ONLY:
        return phrase not in CORE_ONLY[area_code]
    return phrase in GENERIC


if __name__ == '__main__':
    n = sum(len(a['topics']) for a in AREAS)
    print(len(AREAS), 'areas,', n, 'topics,', sum(len(p) for _, _, p in topics()), 'phrases')
    seen = {}
    for a in AREAS:
        assert a['code'] not in seen, a['code']
        seen[a['code']] = a['name']
        for code in (DEFAULT_TOPIC.get(a['code']),):
            if code:
                assert code in [t for t, _ in a['topics']], code
        print(f"  {a['group'][:28]:28} {a['name'][:46]:46} {len(a['topics'])} topics")
