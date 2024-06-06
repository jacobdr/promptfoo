import Datasets from './Datasets';

import { Suspense } from 'react';

export default function Page() {
  return (
    <div>
      <Suspense>
        <Datasets />
      </Suspense>
    </div>
  );
}
