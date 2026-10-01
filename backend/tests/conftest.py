import os
import sys

os.environ["LLM_PROVIDER"] = "mock"
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
