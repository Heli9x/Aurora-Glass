import io
import json
import unittest

from backend.audio import lyrics
from tests.test_auth import AppTestCase

PNG = b'\x89PNG\r\n\x1a\n' + b'\x00' * 32


class LyricsTests(unittest.TestCase):
    def test_rows_are_validated_and_sorted(self):
        rows = lyrics.validate_rows([['b', 0.1, 5], ['a', 0.1, 1], ['  ', 0.1, 2]])
        self.assertEqual([row[0] for row in rows], ['a', 'b'])

    def test_bad_rows_rejected(self):
        for bad in ([['x', 0.1]], [['x', 0, 1]], [['x', 'a', 1]], [['x', 0.1, -1]], 'nope'):
            with self.assertRaises(lyrics.LyricsError):
                lyrics.validate_rows(bad)

    def test_lrc_and_text_and_json(self):
        rows = lyrics.parse('[ti:x]\n[00:01.50]Hello\n[00:05.00]World')
        self.assertEqual([r[0] for r in rows], ['Hello', 'World'])
        self.assertEqual(rows[0][2], 1.5)
        text_rows = lyrics.parse('one\n\ntwo')
        self.assertEqual(len(text_rows), 2)
        self.assertGreater(text_rows[1][2], text_rows[0][2])
        self.assertEqual(lyrics.parse(json.dumps([['hi', 0.1, 0.3]])), [['hi', 0.1, 0.3]])


class AudioApiTests(AppTestCase):
    def upload(self, name='song.mp3', **extra):
        data = {'file': (io.BytesIO(b'ID3' + b'\x00' * 64), name), 'category': 'music', **extra}
        response = self.admin_mutating('post', '/api/upload', data=data,
                                       content_type='multipart/form-data')
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()['file']

    def test_upload_tags_cover_lyrics_and_sorting(self):
        first = self.upload(artist='Zed', album='B', genre='Rock', year='1999', theme='night',
                            cover=(io.BytesIO(PNG), 'c.png'), lyrics='[00:01.00]Hi\n[00:04.00]There')
        self.assertTrue(first['hasCover'] and first['hasLyrics'])
        self.assertEqual((first['artist'], first['year']), ('Zed', 1999))
        second = self.upload('b.mp3', artist='Abe', year='2005')
        self.assertFalse(second['hasCover'] or second['hasLyrics'])

        listing = self.admin_client.get('/api/files?type=music&sort=artist').get_json()['files']
        self.assertEqual([f['artist'] for f in listing], ['Abe', 'Zed'])
        listing = self.admin_client.get('/api/files?type=music&sort=year').get_json()['files']
        self.assertEqual([f['year'] for f in listing], [1999, 2005])
        found = self.admin_client.get('/api/files?q=rock').get_json()['files']
        self.assertEqual(len(found), 1)

        self.assertEqual(self.admin_client.get(f"/api/files/{first['id']}/cover").status_code, 200)
        self.assertEqual(self.admin_client.get(f"/api/files/{second['id']}/cover").status_code, 404)
        rows = self.admin_client.get(f"/api/files/{first['id']}/lyrics").get_json()['lyrics']
        self.assertEqual([r[0] for r in rows], ['Hi', 'There'])

    def test_later_edits(self):
        record = self.upload()
        fid = record['id']
        response = self.admin_mutating('put', f'/api/files/{fid}/lyrics',
                                       json={'lyrics': [['Line', 0.1, 2.0]]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()['file']['hasLyrics'])
        bad = self.admin_mutating('put', f'/api/files/{fid}/lyrics', json={'lyrics': [['x']]})
        self.assertEqual(bad.status_code, 400)
        response = self.admin_mutating('put', f'/api/files/{fid}/cover', data=PNG,
                                       content_type='application/octet-stream')
        self.assertTrue(response.get_json()['file']['hasCover'])
        junk = self.admin_mutating('put', f'/api/files/{fid}/cover', data=b'not an image',
                                   content_type='application/octet-stream')
        self.assertEqual(junk.status_code, 400)
        patched = self.admin_mutating('patch', f'/api/files/{fid}',
                                      json={'genre': 'Jazz', 'year': 1970}).get_json()['file']
        self.assertEqual((patched['genre'], patched['year']), ('Jazz', 1970))
        self.admin_mutating('put', f'/api/files/{fid}/lyrics', json={'text': ''})
        self.assertFalse(self.admin_client.get(f'/api/files/{fid}').get_json()['file']['hasLyrics']
                         if False else self.server.media.find(fid)['hasLyrics'])
        self.admin_mutating('delete', f'/api/files/{fid}')
        self.assertFalse(self.server.audio.assets_dir(fid).exists())


if __name__ == '__main__':
    unittest.main()
