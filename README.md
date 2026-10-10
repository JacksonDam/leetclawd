# LeetClawd

LeetCode inside Claude Code. Read problems, write solutions, and run or submit them while Claude works.

## Install

In Claude Code:

```
/plugin install leetclawd --marketplace JacksonDam/leetclawd
```

## Use

| Command | What it does |
| --- | --- |
| `/leetclawd` | Shows LeetCode once Claude has been thinking for more than 10 seconds and hides it when Claude is done. Your problem and code are kept. |
| `/leetclawdf` | Opens it now and keeps it open. Run it again to close. |
| `/unleetclawd` | Turns it off and clears the open problem, your drafts and the last result. |

Shortcuts, typed in an empty prompt box:

- `;;` shows or hides LeetClawd.
- `;` then a button's letter presses that button: `;r` runs, `;s` submits, `;h` opens help.
- `;1` to `;9` open the numbered rows of the problem list.

Click the code to type in it. `ctrl+r` runs the examples; `ctrl+s` then Enter submits.

## Sign in

Reading problems needs no account. Run and Submit use your own LeetCode session: on the Account screen (`;a`), import it from Safari, Chrome or Firefox, or paste your `LEETCODE_SESSION` cookie. The session is stored on your machine and sent only to leetcode.com.

## Settings

`/plugin configure leetclawd@leetclawd` sets the default language, the thinking delay, the shortcut key and the session cookie.

## Notes

- Written against Claude Code 2.1.296. It uses function hooks, an early-access API that may change.
- Browser import is built for macOS. Chrome and Firefox import need `sqlite3`, and Chrome asks the Keychain before unlocking its cookies.
- Not affiliated with LeetCode.

## Development

```
claude plugin validate .
claude plugin test .
```
