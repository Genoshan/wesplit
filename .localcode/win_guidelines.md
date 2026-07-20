# Windows Environment Guidelines

## Path Handling Rules
- **Use Forward Slashes:** Always use forward slash (/) instead of backslash (\\) in all tool calls. This prevents issues with escape characters and ensures compatibility across different shells.
- **Avoid Raw Drive Letters:** When possible, use relative paths or the path provided by the environment rather than hardcoding "H:\\..." in a way that requires complex escaping.
- **Quote Paths with Spaces:** Always wrap paths containing spaces in double quotes when passing them to PowerShell tools.
- **Standardize on Forward Slashes:** Even on Windows, using forward slashes is generally safer for internal tool processing.