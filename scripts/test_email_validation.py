import unittest
from unittest.mock import patch

try:
    from scripts import email_validation as ev
except ImportError:
    import email_validation as ev


class EmailValidationTests(unittest.TestCase):
    def tearDown(self):
        ev.mail_domain_status.cache_clear()

    def test_syntax_and_multiple_addresses(self):
        self.assertIsNone(ev.domain_of("info@bad..ru"))
        self.assertIsNone(ev.domain_of("info@-bad.ru"))
        self.assertEqual(ev.candidates("bad; mailto:info@example.com"), ["bad", "info@example.com"])

    def test_nonexistent_domain(self):
        with patch.object(ev, "_lookup", return_value={"Status": 3}):
            self.assertEqual(ev.assess_address("info@mehanikaman.ru"), (None, False))

    def test_mx_and_null_mx(self):
        with patch.object(ev, "_lookup", return_value={"Status": 0, "Answer": [{"type": 15, "data": "10 mail.example.com."}]}):
            self.assertEqual(ev.checked_address("info@example.com"), "info@example.com")
        ev.mail_domain_status.cache_clear()
        with patch.object(ev, "_lookup", return_value={"Status": 0, "Answer": [{"type": 15, "data": "0 ."}]}):
            self.assertIsNone(ev.checked_address("info@example.com"))

    def test_implicit_mx_and_temporary_failure(self):
        with patch.object(ev, "_lookup", side_effect=[{"Status": 0}, {"Status": 0, "Answer": [{"type": 1, "data": "192.0.2.1"}]}]):
            self.assertEqual(ev.checked_address("info@example.com"), "info@example.com")
        ev.mail_domain_status.cache_clear()
        with patch.object(ev, "_lookup", side_effect=TimeoutError):
            self.assertEqual(ev.assess_address("info@example.com"), (None, True))


if __name__ == "__main__":
    unittest.main()
