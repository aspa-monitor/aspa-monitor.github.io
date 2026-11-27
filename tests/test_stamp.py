import re
import tempfile
import unittest
from pathlib import Path

from pipeline.build_site import REPO, stamp_assets


class TestStampAssets(unittest.TestCase):
    """Every page and module must load one matching set of assets after a deploy (?v=<hash>)."""

    def build(self, out: Path, extra: str = "") -> str:
        (out / "assets").mkdir(parents=True)
        (out / "lookup").mkdir()
        (out / "lookup" / "index.html").write_text(
            '<link rel="stylesheet" href="/assets/style.css"><script type="module" src="/assets/lookup.js"></script>')
        (out / "assets" / "lookup.js").write_text('import { a } from "./prefix.js";\nimport { b } from "./rov.js";\n' + extra)
        (out / "assets" / "prefix.js").write_text("export const a = 1;")
        (out / "assets" / "style.css").write_text("body{}")
        return stamp_assets(out)

    def test_pages_and_imports_get_the_same_version(self):
        with tempfile.TemporaryDirectory() as d:
            out = Path(d)
            v = self.build(out)
            html = (out / "lookup" / "index.html").read_text()
            js = (out / "assets" / "lookup.js").read_text()
            self.assertIn(f'href="/assets/style.css?v={v}"', html)
            self.assertIn(f'src="/assets/lookup.js?v={v}"', html)
            self.assertIn(f'from "./prefix.js?v={v}"', js)
            self.assertIn(f'from "./rov.js?v={v}"', js)

    def test_version_changes_with_any_asset(self):
        with tempfile.TemporaryDirectory() as a, tempfile.TemporaryDirectory() as b:
            self.assertNotEqual(self.build(Path(a)), self.build(Path(b), extra="// changed"))

    def test_every_real_import_is_stamped(self):
        # Guards the regex against import styles used in site/assets that it would miss.
        with tempfile.TemporaryDirectory() as d:
            import shutil
            out = Path(d) / "site"
            shutil.copytree(REPO / "site", out)
            v = stamp_assets(out)
            for js in (out / "assets").glob("*.js"):
                for spec in re.findall(r'from "([^"]+)"', js.read_text()):
                    self.assertTrue(spec.endswith(f"?v={v}"), f"{js.name}: {spec}")
            for page in out.rglob("*.html"):
                for url in re.findall(r'"(/assets/[^"]+\.(?:js|css)[^"]*)"', page.read_text()):
                    self.assertTrue(url.endswith(f"?v={v}"), f"{page}: {url}")


if __name__ == "__main__":
    unittest.main()


class TestCodeFailureGuard(unittest.TestCase):
    """Every page reloads once if its code fails to load (a 503 on any module blanks the page otherwise)."""

    def test_every_module_script_has_the_guard(self):
        for page in (REPO / "site").rglob("*.html"):
            text = page.read_text()
            tags = re.findall(r"<script type=\"module\"[^>]*>", text)
            self.assertTrue(tags, page)
            self.assertIn("window.codeFailed=function", text, page)
            self.assertLess(text.index("window.codeFailed=function"), text.index('<script type="module"'), page)
            for tag in tags:
                self.assertIn('onerror="codeFailed()"', tag, f"{page}: {tag}")

    def test_stamping_keeps_the_guard(self):
        with tempfile.TemporaryDirectory() as d:
            import shutil
            out = Path(d) / "site"
            shutil.copytree(REPO / "site", out)
            v = stamp_assets(out)
            html = (out / "lookup" / "index.html").read_text()
            self.assertIn(f'src="/assets/lookup.js?v={v}" onerror="codeFailed()"', html)
