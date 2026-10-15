# Folder Shelf Configuration Guide

The collected items are persisted in a single JSON file. This guide describes every configuration field, its legal values, and type constraints.

## File Location

- Default: `~/.folder-shelf/config.json`
- Custom: set `folderShelf.configFile` (a leading `~` expands to the home directory)
- When the file does not exist it is treated as an empty list; operations such as "Open Config File" create it automatically

## Top-Level Structure

| Field | Type | Constraint | Description |
| --- | --- | --- | --- |
| `items` | array | Optional (treated as an empty list when omitted) | List of collected items |
| Other fields | any | Not validated | Custom fields; preserved as-is on write-back, never removed or rewritten |

The top level must be a JSON object; an array or a primitive value is treated as a structure error.

## Items (each element of `items`)

| Field | Type | Constraint | Description |
| --- | --- | --- | --- |
| `path` | string | **Required**, non-empty string (the only hard constraint) | Local path of the folder/file |
| `group` | string | Optional; other types are shown as ungrouped | Group name, displayed in order of first appearance |
| `tags` | string[] | Optional; non-string elements are simply excluded from display and never rewritten | Tag list, multi-select filtering supported |
| Other fields | any | Not validated | Custom fields (e.g. `label`, `sort`), preserved as-is |

Legal values for `path`: any non-empty string.

- **Local absolute paths** (e.g. `/Users/you/projects/demo`) — recommended; icons, child levels and existence checks work as expected
- **Remote / virtual file system URIs** (e.g. `vscode-remote://ssh-host/Users/you/projects/demo`, `vscode-vfs://github/owner/repo`) — fully supported; an "Item is currently unavailable" placeholder is shown while the remote is not connected or the provider is missing
- Relative paths, `~/...` — allowed to register, but entries that cannot be resolved against the local disk show an "Item is missing on disk" placeholder

Items whose `path` is missing, not a string, or an empty string are treated as **invalid items**: they are not rendered,
an "N invalid item(s)" node is shown at the end of the tree (hover for details), and they are preserved as-is on write-back.

## Error Protection

- JSON syntax error / top level not an object / `items` not an array: a dialog reports the error type and location,
  and all add/remove/edit operations are rejected while the error persists — the **config file is never overwritten**;
  everything recovers automatically once the file is fixed and reloaded
- Partially invalid items: the remaining items are unaffected; only an "invalid items" notice node is appended

## Write-Back Rules

- Add/remove/edit operations rewrite only the fields they target; no content is cleaned up automatically
- Unknown fields (top-level and item-level) and invalid items are always preserved as-is
- The order of object keys is not guaranteed to match the original file (content unchanged, order may differ)

## Complete Example

```json
{
  "version": 3,
  "items": [
    {
      "path": "/Users/you/projects/demo",
      "group": "work",
      "tags": ["frontend", "main"],
      "otherField": { "anyKey": 1 }
    },
    {
      "path": "/Users/you/notes"
    }
  ]
}
```

`version` and `otherField` in the example are custom fields: add or remove them freely — the extension will never touch them.
