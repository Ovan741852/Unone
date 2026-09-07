"""Rebuild the curated art slice from the local Creator collection."""
from pathlib import Path
import json, subprocess, sys
ROOT=Path(__file__).resolve().parents[1]
# Gameplay, scene configuration and presentation preferences stay authored files.
# Importers replace only their own asset/entity materialization.
from import_art import main as import_art
import_art()
subprocess.run([sys.executable,str(ROOT/'tools/import_hit.py')],check=True)
print('Prepared original meshes/textures and original GoldCrystal_Hit companions.')
