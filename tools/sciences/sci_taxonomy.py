"""The taxonomy of the three science fields, in the form tools/economics/classify.py expects.

skeleton.py names the areas and topics; the phr_*.py files give each topic its phrases
(PHRASES = {topic name: [phrases]}). This module joins them and adds the rules that tie
journals to areas:
  * HOME: the areas a specialised journal is "at home" in (worth a bonus when scoring);
  * FORCED: journals that publish nothing outside one area; a paper there that matches no
    topic goes to the area's default topic instead of being dropped.
"""
import glob
import importlib.util
import os
import sys

import skeleton as K

HERE = os.path.dirname(os.path.abspath(__file__))
W_TOPICS = 0.5          # weight of a phrase found in a work's OpenAlex topic names (title 4, keywords 2, abstract 1)

GROUPS = [(g, b) for _, g, b in K.GROUPS]


def _phrases():
    out = {}
    for f in sorted(glob.glob(os.path.join(HERE, 'phr_*.py'))):
        spec = importlib.util.spec_from_file_location(os.path.basename(f)[:-3], f)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
        except Exception as e:                            # one broken file must not stop the others
            print(f'warning: skipped {os.path.basename(f)}: {e}', file=sys.stderr)
            continue
        for topic, plist in getattr(mod, 'PHRASES', {}).items():
            out.setdefault(topic, []).extend(plist)
    return out


PHRASES = _phrases()
AREAS = [dict(a, topics=[(t, PHRASES.get(t, [])) for t in a['topics']]) for a in K.AREAS]
FIELD_OF = {a['code']: a['field'] for a in AREAS}
CODES = {f: {a['code'] for a in AREAS if a['field'] == f} for f in K.FIELDS}
LETTER = {'E': 'Econophysics', 'M': 'Mathematics', 'S': 'Statistics'}

# Journal home code (sci_sources.py) -> area codes that count as home.
HOME = {
    'alg': {'algebra', 'alggeom'}, 'numth': {'numth'}, 'alggeom': {'alggeom', 'numth'},
    'geomtop': {'diffgeom', 'topology', 'geometry'}, 'logic': {'logic'},
    'analysis': {'realanal', 'complex', 'funcanal', 'pde'}, 'pde': {'pde', 'funcanal'}, 'dyn': {'dynamics'},
    'prob': {'prob'}, 'mathphys': {'mathphys'}, 'comb': {'comb', 'graph'}, 'tcs': {'tcs', 'info'}, 'info': {'info'},
    'num': {'numerical'}, 'optim': {'optim'}, 'applied': {'applied', 'numerical'}, 'bio': {'applied'},
    'history': {'history'},
    'biostat': {'biostat', 'epistat'}, 'qual': {'design'}, 'bayes': {'bayes'}, 'epi': {'epistat', 'biostat'},
    'comp': {'computing'}, 'ts': {'timeseries'}, 'survey': {'survey'}, 'spatial': {'spatial'},
    'psych': {'psychometrics'}, 'socmeth': {'causal', 'psychometrics', 'missing'}, 'ml': {'learning'},
    'qf': {'ep_stats', 'ep_micro', 'ep_methods'}, 'complex': {'ep_agents', 'ep_complexity'}, '': set(),
}

# Journals (OpenAlex source ids, filled in from sci_sources.py by name) whose every paper belongs to one area.
FORCED_BY_NAME = {
    'Historia Mathematica': 'history', 'Archive for History of Exact Sciences': 'history',
    'Journal of Symbolic Logic': 'logic', 'Annals of Pure and Applied Logic': 'logic',
}
DEFAULT_TOPIC = {
    'history': 'Mathematics from 1700 to 1900',
    'logic': 'Model theory',
}

GENERIC = set()         # phrases that count only in a journal at home in the area


def topics():
    """[(area dict, topic name, [phrases])] in site order."""
    return [(a, name, phrases) for a in AREAS for name, phrases in a['topics']]


def is_home_only(area_code, phrase):
    return phrase in GENERIC


def parse_fields(spec):
    """'M:prob+pde|S' -> {'Mathematics': {'prob', 'pde'}, 'Statistics': None (every area)}."""
    out = {}
    for part in (spec or '').split('|'):
        if not part:
            continue
        letter, _, codes = part.partition(':')
        out[LETTER[letter]] = set(codes.split('+')) if codes else None
    return out


if __name__ == '__main__':
    n = sum(len(p) for _, _, p in topics())
    empty = [t for _, t, p in topics() if not p]
    print(len(AREAS), 'areas,', len(topics()), 'topics,', n, 'phrases;', len(empty), 'topics still without phrases')
