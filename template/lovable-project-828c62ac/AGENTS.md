<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep recruitment template data in a shared frontend module and use a common workspace shell for each persona; this preserves consistent navigation and presentation without implying real authorization or backend functionality.
- Use static persona routes and a validated dynamic route for HR template sections; this keeps every navigation destination shareable while avoiding duplicated page layouts.
