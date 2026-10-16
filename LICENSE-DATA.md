# Data licensing

`LICENSE` (MIT) covers the **software** in this repository. It does not cover every data file
served with it. This note says which is which, because the two are easy to conflate and the
distinction is not reversible once a file has been published under MIT.

Nothing here is legal advice.

## Third-party data, under its own terms

| Data | Terms |
| --- | --- |
| USDA FoodData Central — Foundation Foods, SR Legacy, FNDDS | Public domain |
| Anses Ciqual 2025 | [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) |
| Open Food Facts | [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/) |
| Open Exercise Figures | CC0 |

Each is redistributed on its own terms, which travel with it and are not changed by anything
in this repository.

## Compilations made here

A nutrition figure is a fact, and facts belong to nobody. A **compilation** of them — chosen,
transcribed, checked against the 4/4/9 energy identity, normalised to a common schema and cited
row by row — is a different thing, and in the EU it attracts the *sui generis* database right
(Directive 96/9/EC) for whoever made the investment.

**Already published under MIT, and remaining so.** The 147 Middle Eastern dishes in
`data/mena-sources.json` and `public/data/foods-mena.json` were committed to this repository
before this note existed. MIT cannot be withdrawn from what it has already been granted on, and
pretending otherwise would be worse than leaving it. They stay MIT.

**Not covered by MIT.** The restaurant chain compilation — the per-market menu data for Italy,
Oman and the United States, its citations and its collection notes — is **not** part of the MIT
grant. It is maintained outside this repository (see `README.md` → Eating out) and its build
output is not committed here.

Being downloadable is not a licence. The app is local-first, so the chain file must be served
to the device to work offline; serving it grants no right to copy the compilation, and the file
states its own terms in its header.

Where a chain's own published figures are reproduced, they are reproduced as facts with a
citation to the publisher. Any trade mark named in the data is named to identify whose menu a
figure describes, and for no other purpose.

## If you want to reuse it

The code: take it, it is MIT. The chain compilation: ask.
