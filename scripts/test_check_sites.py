import socket
import json
import tempfile
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch

import check_sites as check


class SiteChecks(unittest.TestCase):
    def test_matches_non_beauty_businesses(self):
        self.assertTrue(check.page_matches('Зёрна — кофейня в Москве. Меню', 'Зёрна', '', 'моск', {'amenity': 'cafe'}))
        self.assertFalse(check.page_matches('Зёрна — автозапчасти в Москве', 'Зёрна', '', 'моск', {'amenity': 'cafe'}))
        self.assertFalse(check.page_matches('Зёрна — кофейня в Самаре', 'Зёрна', '', 'моск', {'amenity': 'cafe'}))

    def test_phone_requires_ten_matching_digits(self):
        self.assertTrue(check.page_matches('Телефон: +7 (900) 123-45-67', 'Зёрна', '8 900 123 45 67', ''))
        self.assertFalse(check.page_matches('Телефон: +7 (999) 123-45-67', 'Зёрна', '+7 900 123 45 67', ''))

    @patch.object(check, 'domain_candidates', return_value=['demo.ru'])
    @patch.object(check, 'fetch_page', side_effect=TimeoutError)
    def test_failed_search_is_not_a_negative_result(self, *_):
        result = check.check_domain('Demo', '', 'моск', detailed=True)
        self.assertFalse(result['complete'])
        self.assertEqual(result['url'], '')

    @patch.object(check, 'domain_candidates', return_value=['demo.ru'])
    @patch.object(check, 'fetch_page', return_value=('https://demo.ru', 'Чужой сайт'))
    def test_completed_search_without_match(self, *_):
        self.assertEqual(check.check_domain('Demo', '', 'моск', detailed=True), {'url': '', 'complete': True})

    @patch.object(check, 'domain_candidates', return_value=['zerna.ru'])
    @patch.object(check, 'fetch_page', return_value=('https://zerna.ru', 'Зёрна — кофейня в Москве'))
    def test_finds_cafe_site(self, *_):
        result = check.check_domain('Зёрна', '', 'моск', {'amenity': 'cafe'}, detailed=True)
        self.assertEqual(result['url'], 'https://zerna.ru')

    @patch.object(check.time, 'sleep')
    @patch.object(check, 'fetch_page', side_effect=urllib.error.URLError(socket.gaierror(socket.EAI_AGAIN, 'Temporary failure')))
    def test_temporary_dns_failure_is_unknown(self, *_):
        self.assertIsNone(check.link_alive('https://example.ru'))

    @patch.object(check, 'fetch_page', side_effect=urllib.error.HTTPError('https://example.ru', 404, '', {}, None))
    def test_deleted_page_is_dead(self, *_):
        self.assertFalse(check.link_alive('https://example.ru'))

    @patch.object(check, 'fetch_page', return_value=('https://example.ru', 'Cafe menu. Free parking available.'))
    def test_parking_amenity_is_not_a_parked_domain(self, *_):
        self.assertTrue(check.link_alive('https://example.ru'))

    def test_report_keeps_checked_url_and_unknown_state(self):
        with tempfile.TemporaryDirectory() as folder:
            data = Path(folder)
            out = data / 'checks'
            out.mkdir()
            (data / 'index.json').write_text(json.dumps({'regions': [{'slug': 'ru-test', 'name': 'Москва'}]}), encoding='utf-8')
            (data / 'ru-test.json').write_text(json.dumps([
                ['n1', 55, 37, {'name': 'Cafe', 'website': 'https://example.ru'}],
                ['n2', 55, 37, {'name': 'Zerna', 'amenity': 'cafe'}],
                ['n3', 55, 37, {'name': 'Found before'}],
            ]), encoding='utf-8')
            (out / 'ru-test.json').write_text(json.dumps({'n3': ['own', 'https://found.example.ru', '2026-01-01', 'd']}), encoding='utf-8')
            with patch.multiple(check, DATA=str(data), OUT=str(out), VK_KEY=''), \
                    patch.object(check, 'vk_links', return_value={}), \
                    patch.object(check, 'push'), \
                    patch.object(check, 'link_alive', return_value=None) as alive, \
                    patch.object(check, 'check_domain', return_value={'url': '', 'complete': False}):
                check.main()
            report = json.loads((out / 'ru-test.json').read_text(encoding='utf-8'))
            self.assertEqual(report['_links']['n1'][0], 'unknown')
            self.assertEqual(report['_links']['n1'][2], 'https://example.ru')
            self.assertEqual(report['n2'][0], 'unknown')
            self.assertEqual(report['n3'][1], 'https://found.example.ru')
            self.assertEqual(alive.call_count, 2)


if __name__ == '__main__':
    unittest.main()
