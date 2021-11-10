/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type {
  NumberPrefixParser,
  DocMetadataBase,
  VersionMetadata,
  SidebarOptions,
} from '../types';
import type {
  Sidebars,
  Sidebar,
  SidebarItem,
  NormalizedSidebarItem,
  NormalizedSidebar,
  NormalizedSidebars,
  SidebarItemsGeneratorOption,
  SidebarItemsGeneratorDoc,
  SidebarItemsGeneratorVersion,
  NormalizedSidebarItemCategory,
  SidebarItemCategory,
  SidebarItemAutogenerated,
} from './types';
import {transformSidebarItems} from './utils';
import {DefaultSidebarItemsGenerator} from './generator';
import {mapValues, memoize, pick} from 'lodash';
import combinePromises from 'combine-promises';

export type SidebarProcessorProps = {
  sidebarItemsGenerator: SidebarItemsGeneratorOption;
  numberPrefixParser: NumberPrefixParser;
  docs: DocMetadataBase[];
  version: VersionMetadata;
  options: SidebarOptions;
};

function toSidebarItemsGeneratorDoc(
  doc: DocMetadataBase,
): SidebarItemsGeneratorDoc {
  return pick(doc, [
    'id',
    'frontMatter',
    'source',
    'sourceDirName',
    'sidebarPosition',
  ]);
}

function toSidebarItemsGeneratorVersion(
  version: VersionMetadata,
): SidebarItemsGeneratorVersion {
  return pick(version, ['versionName', 'contentPath']);
}

// Handle the generation of autogenerated sidebar items and other post-processing checks
async function processSidebar(
  unprocessedSidebar: NormalizedSidebar,
  {
    sidebarItemsGenerator,
    numberPrefixParser,
    docs,
    version,
    options,
  }: SidebarProcessorProps,
): Promise<Sidebar> {
  // Just a minor lazy transformation optimization
  const getSidebarItemsGeneratorDocsAndVersion = memoize(() => ({
    docs: docs.map(toSidebarItemsGeneratorDoc),
    version: toSidebarItemsGeneratorVersion(version),
  }));

  async function processCategoryItem(
    item: NormalizedSidebarItemCategory,
  ): Promise<SidebarItemCategory> {
    return {
      ...item,
      items: (await Promise.all(item.items.map(processItem))).flat(),
    };
  }

  async function processAutoGeneratedItem(
    item: SidebarItemAutogenerated,
  ): Promise<SidebarItem[]> {
    const generatedItems = await sidebarItemsGenerator({
      item,
      numberPrefixParser,
      defaultSidebarItemsGenerator: DefaultSidebarItemsGenerator,
      ...getSidebarItemsGeneratorDocsAndVersion(),
      options,
    });
    return processItems(generatedItems);
  }

  async function processItem(
    item: NormalizedSidebarItem,
  ): Promise<SidebarItem[]> {
    if (item.type === 'category') {
      return [await processCategoryItem(item)];
    }
    if (item.type === 'autogenerated') {
      return processAutoGeneratedItem(item);
    }
    return [item];
  }

  async function processItems(
    items: NormalizedSidebarItem[],
  ): Promise<SidebarItem[]> {
    return (await Promise.all(items.map(processItem))).flat();
  }

  const processedSidebar = await processItems(unprocessedSidebar);

  const fixSidebarItemInconsistencies = (item: SidebarItem): SidebarItem => {
    // A non-collapsible category can't be collapsed!
    if (item.type === 'category' && !item.collapsible && item.collapsed) {
      return {
        ...item,
        collapsed: false,
      };
    }
    return item;
  };
  return transformSidebarItems(processedSidebar, fixSidebarItemInconsistencies);
}

export async function processSidebars(
  unprocessedSidebars: NormalizedSidebars,
  props: SidebarProcessorProps,
): Promise<Sidebars> {
  return combinePromises(
    mapValues(unprocessedSidebars, (unprocessedSidebar) =>
      processSidebar(unprocessedSidebar, props),
    ),
  );
}