# Testing Strategy

## Filosofie
- **Happy Path én Failure Scenarios**: Test niet alleen of het werkt, maar ook of het faalt zoals verwacht.
- **Security First**: Test RLS policies expliciet (mag user A data van user B zien?).
- **Database Integrity**: Test constraints en triggers.

## Test Levels
1. **Unit Tests**: Voor pure functies en logica.
2. **Integration Tests**: Voor Edge Functions en Database interacties.
3. **End-to-End (E2E)**: Voor kritieke flows (Checkout, Transfer).

## Verificatie Scripts (SQL)
Voor elke database migratie of feature:
- Schrijf een SQL script dat de wijziging verifieert.
- Check constraints.
- Check RLS policies (switch roles in SQL).

## Checklist
- [ ] RLS policies getest met verschillende rollen?
- [ ] Constraints getest (duplicate keys, invalid references)?
- [ ] Edge cases getest (null values, empty strings)?
- [ ] Performance impact gecheckt (indexes)?
