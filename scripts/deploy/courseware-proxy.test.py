"""Server-only fixture checks for the reviewed Nginx rewrite; never invokes nginx or touches a live site."""
import os
import pathlib
import re
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = pathlib.Path(__file__).with_name('install-nginx-security-headers.sh')


class CoursewareProxyTests(unittest.TestCase):
    def test_idempotent_exact_capability_locations_keep_teacher_preview_and_api_authentication(self):
        source = SCRIPT.read_text()
        programs = re.findall(r"python3 - <<'PY'\n(.*?)\nPY", source, re.S)
        self.assertEqual(len(programs), 2)
        program = compile(programs[1], str(SCRIPT), 'exec')
        original = '''server {
    listen 443 ssl;
    server_name physics.dongsiwei.com;
    # Existing independent teacher preview must remain unchanged.
    location /teacher-preview/sound-properties-c-20261116/ {
        alias /opt/physicsos-public/teacher-previews/sound-properties-c-20261116/;
    }
    location / {
        proxy_pass http://127.0.0.1:3080;
    }
}
'''
        with tempfile.TemporaryDirectory() as directory:
            site = pathlib.Path(directory) / 'site.conf'
            site.write_text(original)
            with patch.dict(os.environ, {'SITE': str(site), 'SERVER_NAME': 'physics.dongsiwei.com', 'HSTS_MAX_AGE': '31536000'}):
                exec(program, {'__name__': 'fixture'})
                first = site.read_text()
                exec(program, {'__name__': 'fixture'})
                self.assertEqual(first, site.read_text())
            self.assertIn('alias /opt/physicsos-public/teacher-previews/sound-properties-c-20261116/;', first)
            self.assertEqual(first.count('# BEGIN PhysicsOS courseware locations'), 1)
            block = first.split('# BEGIN PhysicsOS courseware locations', 1)[1].split('# END PhysicsOS courseware locations', 1)[0]
            delivery, api = block.split('location /physicsos/courseware {', 1)
            self.assertIn('location ~ "^/physicsos/courseware/(?:embed|content)/[A-Za-z0-9_-]{43}$" {', delivery)
            self.assertIn('proxy_set_header Cookie "";', delivery)
            self.assertIn('proxy_set_header Authorization "";', delivery)
            self.assertIn('proxy_hide_header Set-Cookie;', delivery)
            self.assertIn('access_log off;', delivery)
            self.assertNotIn('proxy_hide_header Content-Security-Policy', delivery)
            self.assertNotIn('add_header Content-Security-Policy', delivery)
            self.assertNotIn('add_header X-Frame-Options', delivery)
            self.assertNotIn('proxy_set_header Cookie "";', api)
            self.assertIn('client_max_body_size 32m;', api)
            for field in ['Dest', 'Mode', 'Site']:
                self.assertIn(f'proxy_set_header Sec-Fetch-{field} $http_sec_fetch_{field.lower()};', delivery)


if __name__ == '__main__':
    unittest.main()
