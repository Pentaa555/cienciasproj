import os
import subprocess
import unittest

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(BASE_DIR, "cad_timiza.html")


class TestBundle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        subprocess.run(["python3", os.path.join(BASE_DIR, "scripts", "bundle.py")], check=True, cwd=BASE_DIR)

    def test_output_exists_and_has_no_placeholders(self):
        with open(OUT_PATH) as f:
            html = f.read()
        self.assertNotIn("__GRAPH_DATA__", html)
        self.assertNotIn("__ALGORITHMS_JS__", html)
        self.assertNotIn("__APP_JS__", html)
        self.assertIn("GRAPH_DATA", html)
        self.assertIn("function astar", html)
        self.assertEqual(html.count("<script"), html.count("</script>"))


if __name__ == "__main__":
    unittest.main()
