require('dotenv').config();
const axios = require('axios').default;
const path = require('path');
const fs = require('fs');
const fsExtra = require('fs-extra');
const fsPromise = fs.promises;
const PromisePool = require('@supercharge/promise-pool');
const { pascalCase } = require('pascal-case');

// 환경 변수 조회
const {
  FIGMA_TOKEN,
  PROJECT_ID,
  SINGLE_COLOR_NODE_ID,
  MULTI_COLOR_NODE_ID,
  REPLACE_COLOR,
} = process.env;

const assetsDir = path.resolve(__dirname, './assets/');

// axios 클라이언트 생성
const client = axios.create({
  baseURL: 'https://api.figma.com',
  headers: {
    'X-Figma-Token': FIGMA_TOKEN,
  },
});

// Figma File 조회
async function getFigmaFile(fileId) {
  const response = await client.get(`/v1/files/${fileId}`);
  return response.data;
}

// Figma SVG URL 생성
async function getFigmaImages(fileId, nodeIds) {
  const response = await client.get(
    `/v1/images/${fileId}/?ids=${nodeIds}&format=svg`
  );
  return response.data.images;
}

// Figma File의 Document 에서 아이콘 추출
function extractIcons(document) {
  const page = document.children[0].children;
  const singleColorIconsNode = page.find(
    (node) => node.id === SINGLE_COLOR_NODE_ID
  );
  const multiColorIconsNode = page.find(
    (node) => node.id === MULTI_COLOR_NODE_ID
  );

  const extractIcons = (node) =>
    node.children
      .filter((node) => node.name.includes('ic_'))
      .map(({ id, name }) => ({ id, name }));

  const [singleColorIcons, multiColorIcons] = [
    singleColorIconsNode,
    multiColorIconsNode,
  ].map(extractIcons);

  // 배열 합쳐서 반환
  return [
    ...singleColorIcons,
    // multi color 아이콘엔 isMultiColor 필드 추가
    ...multiColorIcons.map((icon) => ({
      ...icon,
      isMultiColor: true,
    })),
  ];
}

// 아이콘 다운로드
async function downloadIcon(url, name, isMultiColor) {
  const response = await axios.get(url);
  let { data } = response;
  // isMultiColor 값이 false 면 색상 치환 작업 처리
  if (!isMultiColor) {
    const regex = new RegExp(`="${REPLACE_COLOR}"`, 'g');
    data = data.replace(regex, '="currentColor"');
  }
  const directory = path.resolve(assetsDir, `./${name}.svg`);
  return fsPromise.writeFile(directory, data);
}

async function cloneDirectory(src, dest) {
  if (!fs.existsSync(dest)) {
    await fsPromise.mkdir(dest, { recursive: true });
  }
  return fsExtra.copySync(src, dest);
}

function generateAssetIndex(names, assetIndexDir) {
  const code = names
    .map(
      (name) =>
        `export { ReactComponent as ${name.replace(
          /^ic_/,
          ''
        )} } from './${name}.svg';`
    )
    .join('\n');
  return fsPromise.writeFile(assetIndexDir, code, 'utf8');
}

function generateComponentIndex(names, componentIndexDir) {
  const code = names
    .map(
      (name) =>
        `export { ReactComponent as ${pascalCase(
          name.replace(/^ic_/, '')
        )}Icon } from './assets/${name}.svg';`
    )
    .join('\n');
  return fsPromise.writeFile(componentIndexDir, code, 'utf8');
}

async function sync() {
  const figmaFile = await getFigmaFile(PROJECT_ID);
  const icons = extractIcons(figmaFile.document);
  const images = await getFigmaImages(
    PROJECT_ID,
    icons.map((icon) => icon.id).join(',')
  );

  // assetsDir 제거 후 생성
  fsExtra.removeSync(assetsDir);
  fsExtra.mkdirSync(assetsDir);

  // 동시에 최대 3개씩 처리
  // 지금은 아이콘이 몇개 없어서 4로 처리했으며, 이 수치를 20정도로 올려도 무방합니다
  await PromisePool.withConcurrency(3)
    .for(icons)
    .process((icon) => {
      return downloadIcon(images[icon.id], icon.name, icon.isMultiColor);
    });

  const webIconsDir = path.resolve(__dirname, '../web-icons/src');
  const webIconsAssetsDir = path.resolve(webIconsDir, 'assets');
  cloneDirectory(assetsDir, webIconsAssetsDir);
  const assetIndexDir = path.resolve(webIconsAssetsDir, 'index.ts');
  const iconNames = icons.map((icon) => icon.name);
  generateAssetIndex(iconNames, assetIndexDir);
  const componentIndexDir = path.resolve(webIconsDir, 'components.ts');
  generateComponentIndex(iconNames, componentIndexDir);
}

sync();
