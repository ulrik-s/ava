# Accessibility-skuld

Hittade via testning: form-labels är inte associerade med inputs (saknar
`htmlFor`/`id`). Det bryter mot WCAG 2.1 SC 1.3.1 (Info and Relationships)
och 4.1.2 (Name, Role, Value), och gör att skärmläsare inte kan annonsera
fältnamn när användaren navigerar med tab.

Det förhindrar också `getByLabelText` i Testing Library — vilket är den
föredragna queryn för formulärtester eftersom den tvingar fram a11y-korrekt
markup.

## Filer som behöver fixas

| Fil | Antal labels |
|---|---|
| `src/app/contacts/page.tsx` | 8 |
| `src/app/contacts/[id]/page.tsx` | flera |
| `src/app/conflicts/page.tsx` | 1+ |
| `src/app/invoices/[id]/page.tsx` | 8 |
| `src/app/matters/page.tsx` | 4 |
| `src/app/matters/[id]/page.tsx` | många |
| `src/app/reports/page.tsx` | 3 |
| `src/app/settings/page.tsx` | 8+ |
| `src/app/templates/page.tsx` | flera |
| `src/app/time/page.tsx` | 4 |
| `src/app/users/new/page.tsx` | 7 |
| `src/app/users/[id]/page.tsx` | 7 |
| `src/components/invoices-section.tsx` | flera |
| `src/components/payment-method-card.tsx` | 3 |

`src/app/login/page.tsx` är **fixad** som referens.

## Mönster för fix

Innan:
```tsx
<label className="...">E-postadress</label>
<input type="email" value={email} onChange={...} />
```

Efter:
```tsx
<label htmlFor="login-email" className="...">E-postadress</label>
<input id="login-email" type="email" value={email} onChange={...} />
```

För dynamiska id-prefix (t.ex. inom modal som öppnas flera gånger), använd
`useId()`:

```tsx
const formId = useId();
// ...
<label htmlFor={`${formId}-email`}>E-post</label>
<input id={`${formId}-email`} ... />
```

## Eslint-regel som kan fånga detta

`jsx-a11y/label-has-associated-control` — kräver att varje `<label>` har
antingen ett wrappat `<input>` eller ett `htmlFor` som matchar ett
`id`-attribut i samma scope.

Lägg till i eslint.config.mjs när reglerna slås på:

```js
import jsxA11y from "eslint-plugin-jsx-a11y";

// ...
{
  plugins: { "jsx-a11y": jsxA11y },
  rules: {
    "jsx-a11y/label-has-associated-control": "error",
  },
}
```

## Prioritet

**Medium** — appen fungerar för seende mus-användare men:
- Skärmläsare läser inte upp fältnamn → ej användbar för synskadade
- Auto-fyll och formulärs-validering i webbläsare lider
- Tester tvingas runt med `getByPlaceholderText`/`getByRole` istället för
  den semantiskt korrekta `getByLabelText`

Bör fixas före "professional polish"-release.
