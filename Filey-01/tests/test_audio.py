import io
import json
import base64
import unittest

from backend.audio import lyrics
from backend.audio import service as audio_service
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

    def test_row_files_are_read_in_any_reasonable_shape(self):
        two = [['a', 0.6, 1.0], ['b', 0.6, 5.0]]
        shapes = {
            'strict': '[["a", 0.6, 1], ["b", 0.6, 5]]',
            'multiline_trailing_comma': '[\n  ["a", 0.6, 1],\n  ["b", 0.6, 5],\n]\n',
            'no_outer_brackets': '["a", 0.6, 1], ["b", 0.6, 5]',
            'no_commas_between_rows': '[\n["a", 0.6, 1]\n["b", 0.6, 5]\n]',
            'single_quotes': "[['a', 0.6, 1], ['b', 0.6, 5]]",
            'tuples': '[("a", 0.6, 1), ("b", 0.6, 5)]',
            'python_assignment': 'lyrics = [\n    ("a", 0.6, 1),\n    ("b", 0.6, 5),\n]',
            'comments': '# song\n[\n["a", 0.6, 1], // intro\n["b", 0.6, 5]\n]',
            'leading_dot_numbers': '[["a", .6, 1.], ["b", .6, 5.]]',
            'string_numbers': '[["a", "0.6", "1"], ["b", "0.6", "5"]]',
            'smart_quotes': '[[\u201ca\u201d, 0.6, 1], [\u201cb\u201d, 0.6, 5]]',
            'bom_and_crlf': '\ufeff[\r\n["a", 0.6, 1],\r\n["b", 0.6, 5]\r\n]',
            'object': '{"lyrics": [["a", 0.6, 1], ["b", 0.6, 5]]}',
        }
        for name, source in shapes.items():
            with self.subTest(shape=name):
                self.assertEqual(lyrics.parse(source), two)
        self.assertEqual(lyrics.parse('["a", 0.6, 1]'), [['a', 0.6, 1.0]])

    def test_row_text_may_contain_punctuation(self):
        source = ('[["Don\'t go no (go no) go nowhere", 0.8, 109.0],'
                  ' ["Hello, world [ok]", 0.7, 116.0],'
                  ' ["He said \\"hi\\"", 0.7, 120.0],'
                  ' ["(song)", 0.7, 125.0]]')
        self.assertEqual([row[0] for row in lyrics.parse(source)],
                         ["Don't go no (go no) go nowhere", 'Hello, world [ok]', 'He said "hi"', '(song)'])
        bare = "['Can\'t fight it, (oh)', 0.09, 0.21]"
        self.assertEqual(lyrics.parse(bare), [["Can't fight it, (oh)", 0.09, 0.21]])

    def test_real_lyrica_file(self):
        source = (
            '[\n  ["all I want is you", 0.09, 0.17],\n  ["You got me in my feelings", 0.09, 0.19],\n'
            '  ["Can\'t fight the way feel it(oh)", 0.09, 0.21],\n'
            '  ["take me some where, far away from here", 0.20, 0.25],\n  ["(oh-oh oh)", 0.09, 0.1],\n]\n')
        rows = lyrics.parse(source)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0], ['(oh-oh oh)', 0.09, 0.1])   # sorted by start second

    def test_non_row_text_is_not_mistaken_for_rows(self):
        self.assertEqual([r[0] for r in lyrics.parse('[Verse 1]\nhello there\n[Chorus]\nla la')],
                         ['[Verse 1]', 'hello there', '[Chorus]', 'la la'])
        self.assertEqual(len(lyrics.parse('[00:01.00]Hi\n[00:04.00]There')), 2)
        with self.assertRaises(lyrics.LyricsError):
            lyrics.parse('[not json', 'json')
        with self.assertRaises(lyrics.LyricsError):
            lyrics.parse('[["a", 1], ["b", 5]]')   # rows need a speed and a start second

    def test_plain_text_is_spread_over_the_song(self):
        text = ("[Chorus]\nDon't speak on my life please\nI know I'm not living for you\n\n"
                "[Verse]\nHold your mouth and freeze\nYou have no idea")
        rows = lyrics.parse(text, duration=200)
        starts = [row[2] for row in rows]
        self.assertEqual(len(rows), 6)
        self.assertEqual(starts, sorted(set(starts)))
        self.assertGreaterEqual(starts[0], 3)
        self.assertLess(rows[-1][2] + len(rows[-1][0]) * rows[-1][1], 200)
        self.assertGreater(starts[3] - starts[2], starts[2] - starts[1])   # the blank line adds room
        self.assertLess(lyrics.parse(text)[-1][2], 60)                      # unknown length: fixed layout

    def test_lrc_offset_and_fractions(self):
        rows = lyrics.parse('[offset:+500]\n[00:10.00]hello\n[00:20.00]there')
        self.assertEqual([row[2] for row in rows], [9.5, 19.5])   # positive offset shows lines sooner
        rows = lyrics.parse('[01:02.5]a\n[01:03.05]b\n[01:04:25]c\n[01:05.123]d')
        self.assertEqual([row[2] for row in rows], [62.5, 63.05, 64.25, 65.123])


def tagged_mp3(**tags):
    from mutagen.id3 import APIC, ID3, TALB, TCON, TDRC, TIT2, TPE1, USLT
    import tempfile
    from pathlib import Path
    path = Path(tempfile.mkdtemp()) / 't.mp3'
    path.write_bytes(b'\xff\xfb\x90\x00' + b'\x00' * 400)
    frames = ID3()
    frames.add(TIT2(text='Tagged Title'))
    frames.add(TPE1(text='Tag Artist'))
    frames.add(TALB(text='Tag Album'))
    frames.add(TCON(text='Tag Genre'))
    frames.add(TDRC(text='2011'))
    frames.add(USLT(encoding=3, lang='eng', desc='', text='[00:01.00]embedded line'))
    frames.add(APIC(encoding=3, mime='image/png', type=3, desc='', data=PNG))
    frames.save(path)
    data = path.read_bytes()
    path.unlink()
    path.parent.rmdir()
    return data


class SyncedLyricsTests(unittest.TestCase):
    def test_sylt_is_preferred_and_stamped_uslt_beats_plain(self):
        import tempfile
        from pathlib import Path
        from mutagen.id3 import ID3, SYLT, USLT
        path = Path(tempfile.mkdtemp()) / 't.mp3'
        path.write_bytes(b'\xff\xfb\x90\x00' + b'\x00' * 400)
        try:
            frames = ID3()
            frames.add(USLT(encoding=3, lang='eng', desc='a', text='plain one\nplain two'))
            frames.add(USLT(encoding=3, lang='deu', desc='b', text='[00:05.00]stamped'))
            frames.save(path)
            self.assertEqual(audio_service.read_embedded(path)['lyrics'], '[00:05.00]stamped')
            frames.add(SYLT(encoding=3, lang='eng', format=2, type=1, desc='s',
                            text=[('first', 5230), ('\nsecond', 69500)]))
            frames.save(path)
            self.assertEqual(lyrics.parse(audio_service.read_embedded(path)['lyrics'])[1][:1] + [0],
                             ['second', 0])
            self.assertEqual([row[2] for row in lyrics.parse(audio_service.read_embedded(path)['lyrics'])], [5.23, 69.5])
        finally:
            path.unlink(missing_ok=True)
            path.parent.rmdir()


class VorbisCoverTests(unittest.TestCase):
    def test_base64_picture_block_is_decoded(self):
        from mutagen.flac import Picture
        picture = Picture()
        picture.data = PNG
        picture.type = 3
        picture.mime = 'image/png'
        encoded = base64.b64encode(picture.write()).decode()
        self.assertEqual(audio_service._vorbis_cover({'metadata_block_picture': [encoded]}), PNG)
        self.assertIsNone(audio_service._vorbis_cover({'metadata_block_picture': ['!!']}))


class EmbeddedDefaultsTests(AppTestCase):
    def upload(self, data, name='song.mp3', **extra):
        form = {'file': (io.BytesIO(data), name), 'category': 'music', **extra}
        response = self.admin_mutating('post', '/api/upload', data=form, content_type='multipart/form-data')
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        return response.get_json()['file']

    def test_embedded_tags_are_defaults_and_user_edits_win(self):
        record = self.upload(tagged_mp3())
        self.assertEqual((record['artist'], record['album'], record['genre'], record['year']),
                         ('Tag Artist', 'Tag Album', 'Tag Genre', 2011))
        self.assertEqual(record['name'], 'Tagged Title')
        self.assertTrue(record['hasCover'] and record['hasLyrics'])
        fid = record['id']

        # The wizard resends unchanged values: they must keep following the file.
        self.admin_mutating('patch', f'/api/files/{fid}', json={'artist': 'Tag Artist', 'genre': 'Jazz'})
        pointer = self.server.media.pointer_data(fid)
        self.assertEqual(pointer['audio'], {'genre': 'Jazz'})
        current = self.server.media.find(fid)
        self.assertEqual((current['artist'], current['genre']), ('Tag Artist', 'Jazz'))

        # Clearing is a deliberate override; renaming beats the title tag.
        self.admin_mutating('patch', f'/api/files/{fid}', json={'album': '', 'name': 'My Mix'})
        current = self.server.media.find(fid)
        self.assertEqual((current['album'], current['name']), ('', 'My Mix'))

        # Rescanning refreshes defaults but never touches user choices.
        self.admin_mutating('put', f'/api/files/{fid}/lyrics', json={'lyrics': [['mine', 0.1, 1.0]]})
        self.admin_mutating('delete', f'/api/files/{fid}/cover')
        self.assertEqual(self.admin_mutating('post', '/api/library/audio/rescan?force=true').get_json()['scanned'], 1)
        current = self.server.media.find(fid)
        self.assertFalse(current['hasCover'])
        self.assertEqual(self.server.audio.get_lyrics(fid), [['mine', 0.1, 1.0]])
        self.assertEqual((current['genre'], current['artist']), ('Jazz', 'Tag Artist'))

    def test_saving_embedded_lyrics_unchanged_keeps_following_file(self):
        record = self.upload(tagged_mp3())
        fid = record['id']
        rows = self.server.audio.get_lyrics(fid)
        self.admin_mutating('put', f'/api/files/{fid}/lyrics', json={'lyrics': rows})
        self.assertEqual(self.server.media.pointer_data(fid)['assets']['lyrics'], 'embedded')

    def test_existing_and_linked_tracks_get_scanned(self):
        record = self.upload(b'ID3' + b'\x00' * 64)
        self.assertEqual(record['artist'], '')
        path = self.server.media.source_path(self.server.media.find(record['id']))
        path.write_bytes(tagged_mp3())
        self.server.media.edit_pointer(record['id'], lambda p: p.pop('embedded_scanned', None))
        self.admin_client.get('/api/files?type=music')
        self.assertEqual(self.server.media.find(record['id'])['artist'], 'Tag Artist')

    def test_empty_scan_is_retried(self):
        record = self.upload(b'ID3' + b'\x00' * 64)
        self.assertTrue(self.server.media.pointer_data(record['id'])['embedded_scanned'])
        path = self.server.media.source_path(self.server.media.find(record['id']))
        path.write_bytes(tagged_mp3())
        self.admin_client.get('/api/files?type=music')
        self.assertEqual(self.server.media.find(record['id'])['artist'], 'Tag Artist')


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

        def names(query):
            return [f['artist'] for f in self.admin_client.get('/api/files?type=music&' + query).get_json()['files']]
        self.assertEqual(names('artist=zed'), ['Zed'])
        self.assertEqual(names('year=2005'), ['Abe'])
        self.assertEqual(names('genre=Rock&artist=Abe'), [])
        self.assertEqual(len(names('')), 2)
        facets = self.admin_client.get('/api/library/audio/facets').get_json()
        self.assertEqual([i['value'] for i in facets['artist']], ['Abe', 'Zed'])
        self.assertEqual(facets['genre'], [{'value': 'Rock', 'count': 1}])
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
