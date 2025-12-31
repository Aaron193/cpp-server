# Client Static Assets

This directory should contain the built browser client files.

Copy the built client from `../../client/dist/` to this location:

```bash
# From project root
cp -r client/dist/* web/src/static/client/
```

The web server will serve these files at the root path `/`.
