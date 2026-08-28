/**
 * src/v2/components/TwoColumnGrid.jsx
 *
 * Purpose: reusable two-column layout primitive — MUI Grid2 container with
 * responsive half-width items and optional full-width span rows.
 */

import React from 'react';
import Grid2 from '@mui/material/Grid2';
import { useTheme } from '@mui/material/styles';

/**
 * @param {object} props
 * @param {boolean} [props.span=false] — full-width row spanning both columns
 * @param {React.ReactNode} props.children — usually a {@link Panel}
 */
export function TwoColumnGridItem({ span = false, children }) {
  return (
    <Grid2
      size={span ? 12 : { xs: 12, md: 6 }}
      sx={{ minWidth: 0, maxWidth: '100%' }}
    >
      {children}
    </Grid2>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children — use {@link TwoColumnGridItem} for each cell
 * @param {object} [props.sx]
 */
export function TwoColumnGrid({ children, sx, ...rest }) {
  const theme = useTheme();
  const pad = theme.initiative?.space?.['4xl'] ?? '24px';
  const padMobile = theme.initiative?.space?.['3xl'] ?? '20px';

  return (
    <Grid2
      container
      spacing={3}
      data-primitive="two-column-grid"
      sx={{
        maxWidth: '1660px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
        alignItems: 'start',
        padding: {
          xs: `${padMobile} 15px calc(${padMobile} * 2)`,
          md: `${pad} ${pad} calc(${pad} * 2)`,
        },
        ...sx,
      }}
      {...rest}
    >
      {children}
    </Grid2>
  );
}

export default TwoColumnGrid;
