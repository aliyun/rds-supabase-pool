import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from poolctl import cli


class FindAppTests(unittest.TestCase):
    def test_returns_first_matching_instance(self):
        overview = {
            "instances": [
                {"app_name": "other", "id": "1"},
                {"app_name": "demo", "id": "2"},
                {"app_name": "demo", "id": "3"},
            ]
        }
        self.assertEqual(cli.find_app(overview, "demo")["id"], "2")

    def test_raises_when_app_is_missing(self):
        with self.assertRaises(cli.PoolCtlError):
            cli.find_app({"instances": []}, "missing")


class ShellQuoteTests(unittest.TestCase):
    def test_plain_value_is_unchanged(self):
        self.assertEqual(cli.shell_quote("abc-123:/x@y%+z"), "abc-123:/x@y%+z")

    def test_value_with_spaces_is_quoted(self):
        self.assertEqual(cli.shell_quote("hello world"), "'hello world'")

    def test_single_quote_is_escaped(self):
        self.assertEqual(cli.shell_quote("a'b"), "'a'\"'\"'b'")


if __name__ == "__main__":
    unittest.main()
