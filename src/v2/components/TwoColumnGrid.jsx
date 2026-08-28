/**
 * src/v2/components/TwoColumnGrid.jsx
 *
 * Purpose: reusable MUI Grid2 layout primitive mirroring `.init-view__grid` —
 * two columns, optional full-width span children, one column on narrow viewports.
 */

import React from 'react';
import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid2';
import { initiativeSpace } from '../theme.js';

const GRID_MAX_WIDTH_PX = 1660;

/**
 * @param {object} props
 * @param {boolean} [props.span=false] — full-width row spanning both columns
 * @param {React.ReactNode} props.children
 */
export function TwoColumnGridItem({ span = false, children, sx, ...rest }) {
  return (
    <Grid
      size={span ? 12 : { xs: 12, lg: 6 }}
      sx={{ minWidth: 0, ...sx }}
      data-primitive="two-column-grid-item"
      data-grid-span={span ? 'true' : 'false'}
      {...rest}
    >
      {children}
    </Grid>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children — use {@link TwoColumnGridItem} for each cell
 * @param {object} [props.sx]
 */
export function TwoColumnGrid({ children, sx, ...rest }) {
  const gutter = initiativeSpace['4xl'];

  return (
    <Box
      component="div"
      data-primitive="two-column-grid"
      sx={{
        maxWidth: GRID_MAX_WIDTH_PX,
        mx: 'auto',
        width: '100%',
        boxSizing: 'border-box',
        ...sx,
      }}
      {...rest}
    >
      <Grid
        container
        columns={12}
        sx={{
          gap: gutter,
          pt: gutter,
          px: gutter,
          pb: `calc(${gutter} * 2)`,
          alignItems: 'start',
        }}
      >
        {children}
      </Grid>
    </Box>
  );
}

export default TwoColumnGrid;
