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
 * @param {object} [props.sx] — merged after the defaults, so a caller can take
 *   `display` back (COMMAND needs `display: contents` at `xs` to hold its mobile
 *   reading order while its two column-stacks merge into one row above `lg`)
 */
export function TwoColumnGridItem({ span = false, children, sx, ...rest }) {
  return (
    <Grid2
      size={span ? 12 : { xs: 12, lg: 6 }}
      sx={{ minWidth: 0, maxWidth: '100%', ...sx }}
      {...rest}
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
